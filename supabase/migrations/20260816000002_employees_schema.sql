-- =============================================================================
-- Migration: 20260816000002_employees_schema.sql
-- Purpose:   Employees module database layer.
--            Extends public.profiles with `status` and `deactivated_at` columns
--            tracking lifecycle state (active / pending / deactivated). Adds
--            projected views for employee directory and admin employee list.
--            Adds SECURITY DEFINER RPCs for privileged writes (role change,
--            deactivation, reactivation, and self-activation via invite) with
--            last-admin-lockout and self-modification guards.
--            Updates the JWT hook SELECT to include `status` in the token so
--            middleware can block deactivated sessions without a DB round-trip.
--
-- Depends on:
--   20260802000001_auth_schema.sql       — public.profiles table definition
--   20260802000002_jwt_sync_hook.sql     — custom_access_token_hook function
--   20260809000001_teams_schema.sql      — (no dependency; listed for ordering)
--   20260816000001_fix_team_members_rls_recursion.sql — (no dependency; listed for ordering)
--
-- Rollback stub (dev/staging only, NEVER run on production data):
--   DROP VIEW IF EXISTS public.admin_employee_list;
--   DROP VIEW IF EXISTS public.employee_directory;
--   -- NOTE: profiles_select_employee_directory was dropped in this migration (H-2 fix).
--   --       No rollback action needed — restoring it would re-introduce the security gap.
--   DROP FUNCTION IF EXISTS public.change_employee_role(uuid, text) CASCADE;
--   DROP FUNCTION IF EXISTS public.deactivate_employee(uuid) CASCADE;
--   DROP FUNCTION IF EXISTS public.reactivate_employee(uuid) CASCADE;
--   DROP FUNCTION IF EXISTS public.activate_invited_employee() CASCADE;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS status;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS deactivated_at;
--   -- Then restore custom_access_token_hook from 20260802000002 if needed.
--
-- Design notes:
--
--   STATUS COLUMN (not is_active boolean):
--     The PRD recommends a `status` enum column ('active', 'pending', 'deactivated')
--     over a boolean is_active because it avoids the ambiguity between "not yet
--     accepted" and "admin-deactivated". This migration implements that recommendation
--     using a CHECK constraint on text (same pattern as profiles.role in auth_schema):
--     ALTER TYPE is lock-heavy; CHECK on text is a simple constraint add.
--
--   NO NEW TABLES:
--     The PRD explicitly states "No new tables are introduced by the Employees module."
--     Invitations go through auth.admin.inviteUserByEmail (Supabase Auth admin API).
--     The invited user's profile row is inserted by the Server Action at invite time
--     with status = 'pending'. There is no separate employee_invitations table.
--
--   JWT HOOK UPDATE (option a — include status in token):
--     The JWT hook is updated here (via CREATE OR REPLACE FUNCTION) to include the
--     `status` claim in app_metadata. This allows Next.js middleware to read
--     `status` from the JWT and block deactivated sessions without a DB round-trip.
--     The alternative (middleware queries profiles on every request) was rejected:
--     it adds a synchronous DB query to every server-side page load, increases
--     latency for all users, and creates a single point of failure. The JWT TTL
--     (default 1 hour in Supabase) is acceptable for deactivation — the PRD
--     documents that the deactivated user's active session continues until the
--     next session refresh, at which point the updated JWT will carry status =
--     'deactivated' and middleware will reject it. For immediate revocation, the
--     Server Action should call auth.admin.banUser() which invalidates the session.
--     We update the existing hook function in-place (CREATE OR REPLACE) rather than
--     creating a new migration file because the hook signature is unchanged and the
--     Supabase Dashboard registration does not need to be re-done.
--
--   RLS ANTI-RECURSION:
--     The employee_directory view reads company_id from the JWT (app_metadata),
--     NOT from a self-referential subquery on public.profiles. The view runs
--     under SECURITY DEFINER semantics (definer context evaluates the auth-
--     migration policies, none of which reference profiles in their USING
--     clause). No recursive policy evaluation path exists.
--
--   PROJECTED VIEWS (H-2) + BASE-TABLE POLICY DROP:
--     Two views replace direct base-table access for directory/list reads:
--       public.employee_directory — minimal projection (id, display_name, role).
--         Granted to authenticated. Employees use this for co-worker lookups.
--         WHERE-scoped to the caller's company_id via JWT claim inside the view
--         definition (view runs as definer by default; explicit security_invoker=false
--         is set for clarity).
--       public.admin_employee_list — full projection joining profiles + auth.users.
--         Granted to service_role ONLY. Admin Server Actions use this via the
--         service-role client. Not accessible via anon/authenticated key.
--     The profiles_select_employee_directory policy is DROPPED in Section 3
--     (not narrowed — dropped entirely). The three auth-migration policies cover
--     all legitimate access: own row, company-admin read-all, platform-admin read-all.
--     Plain employees have no business reason to query the base profiles table
--     directly; their sole path is the employee_directory view. Dropping the
--     policy closes the REST bypass that allowed reading status/is_platform_admin
--     via a direct GET /rest/v1/profiles call. See Section 3 for full rationale.
--
--   RPC SECURITY MODEL:
--     Role changes and deactivation/reactivation are SECURITY DEFINER functions
--     callable via service-role only (REVOKE from PUBLIC, GRANT to service_role).
--     activate_invited_employee() is SECURITY DEFINER callable by authenticated
--     (the invited user self-activates from their session). This matches the
--     pattern established by create_profile_for_user. The Server Actions call
--     these RPCs via the service-role client; they do NOT bypass application-layer
--     validation — that still happens in the Service layer — but the DB functions
--     also enforce the critical invariants (last-admin lockout, self-modification
--     prevention) as a defense-in-depth guarantee.
--
--   MULTI-TENANCY READINESS:
--     The `status` column carries no tenant scope itself — tenancy continues to
--     live in `company_id` (already on profiles). All RPC functions accept a
--     p_target_profile_id and validate company_id match for non-platform admins.
--     The pattern is ready for multi-tenant extension without breaking changes.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Add `status` column to public.profiles
--
-- Values:
--   'active'      — normal, logged-in user
--   'pending'     — invited but has not yet accepted (clicked the invite link
--                   and set their password). The Server Action creates the profile
--                   row with this status at invite time.
--   'deactivated' — admin-deactivated. Cannot log in. Historical data preserved.
--
-- Default 'active' covers all existing profile rows (signup path), which
-- transition through no pending state.
--
-- NOT NULL with a CHECK constraint (not a Postgres enum type) — consistent
-- with how profiles.role was modeled in the auth migration (ADR: CHECK on text
-- is simpler to evolve than ALTER TYPE on an enum).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Add the CHECK constraint only if it does not already exist.
-- We use a DO block to guard against re-run errors.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'profiles_status_check'
      AND  conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('active', 'pending', 'deactivated'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.profiles.status IS
  'Lifecycle state of the profile. ''active'': normal user. ''pending'': invited, '
  'not yet accepted. ''deactivated'': admin-deactivated, cannot log in. '
  'Changed only via SECURITY DEFINER RPCs or service-role Server Actions. '
  'Never written directly from an authenticated client session.';


-- ---------------------------------------------------------------------------
-- 1b. Add `deactivated_at` column to public.profiles (M-3)
--
-- Records the timestamp of the most recent deactivation for audit and display
-- purposes (PRD EC-5: historical data preservation).
--
-- Invariant: deactivated_at IS NOT NULL ↔ status = 'deactivated'
-- Enforced by a CHECK constraint below (prevents deactivated_at being set
-- while status is still 'active' or 'pending', and prevents it being NULL
-- when status = 'deactivated').
--
-- Set by deactivate_employee RPC. Cleared (set to NULL) by reactivate_employee.
-- NULL for all rows that were never deactivated.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.deactivated_at IS
  'Timestamp of the most recent deactivation (UTC). NULL if never deactivated '
  'or currently active/pending. Set by deactivate_employee RPC; cleared by '
  'reactivate_employee RPC. PRD EC-5 audit requirement.';

-- Add consistency CHECK: deactivated_at must be NULL unless status = 'deactivated'.
-- Also enforces: if status = 'deactivated', deactivated_at must be NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'profiles_deactivated_at_status_check'
      AND  conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_deactivated_at_status_check
      CHECK (
        (status = 'deactivated' AND deactivated_at IS NOT NULL)
        OR
        (status != 'deactivated' AND deactivated_at IS NULL)
      );
  END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Index to support status-filtered queries
--
-- Query patterns requiring this index:
--
--   E1. "Give me all active employees in company X" — used by the employee picker
--       in task assignment and team member addition. Filters on (company_id, status)
--       and the existing idx_profiles_company_id_role covers (company_id, role) —
--       a composite covering (company_id, status) is cheaper for this pattern.
--
--   E2. "Give me all profiles in company X with status != 'deactivated'" —
--       effectively the same predicate as E1 in the employee directory query.
--
--   The existing idx_profiles_company_id_role (company_id, role) does NOT cover
--   status filtering efficiently. A composite (company_id, status) index is added.
--   This does not replace the existing index — role-only filters still benefit
--   from idx_profiles_company_id_role.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_company_id_status
  ON public.profiles (company_id, status);

COMMENT ON INDEX public.idx_profiles_company_id_status IS
  'Supports employee list queries filtered by company + status (E1, E2). '
  'Used by the employee picker to exclude deactivated users and by the admin '
  'list to group/filter by status.';


-- ---------------------------------------------------------------------------
-- 3. RLS policy update on public.profiles + projected views (H-2)
--
-- The existing policies from 20260802000001 cover:
--   profiles_select_own             — own row
--   profiles_select_company_admin   — company admins read all in their company
--   profiles_select_platform_admin  — platform admins read all
--   profiles_insert_own             — defense-in-depth insert own row
--   profiles_update_own             — update own display_name
--   profiles_update_platform_admin  — platform admin update any row
--
-- H-2 SECURITY FIX (DROP of profiles_select_employee_directory):
--   The policy was previously added here to give plain employees company-scoped
--   SELECT on the base profiles table. This is the security gap the reviewer
--   identified: an authenticated employee could call the Supabase REST endpoint
--   directly (e.g. GET /rest/v1/profiles?company_id=eq.{id}) and read `status`,
--   `is_platform_admin`, and `deactivated_at` for every colleague — columns that
--   must not leak to non-admin users.
--
--   The three policies in 20260802000001 already cover every legitimate access path:
--     - profiles_select_own           → any user reads their own row (self-reads, useCurrentUser)
--     - profiles_select_company_admin → company admins read all rows in their company
--     - profiles_select_platform_admin→ platform admins read all rows
--
--   Plain employees have no legitimate need to query the base table directly.
--   Their access path is exclusively via public.employee_directory (view below),
--   which projects only id, display_name, role — no sensitive columns.
--
--   Removing this policy closes the REST bypass entirely: with no permissive
--   policy matching a plain employee querying the base table, Postgres denies
--   the row (not the query — Postgres returns empty, not an error, per RLS
--   semantics). The employee_directory view remains their sole access path.
--
-- ANTI-RECURSION NOTE:
--   The drop of this policy does NOT introduce recursion. The views below still
--   read from public.profiles under SECURITY DEFINER semantics (definer context
--   holds the policies that apply to the view owner). The existing auth-migration
--   policies remain in effect for their respective callers.
-- ---------------------------------------------------------------------------

-- H-2 fix: drop the policy that allowed plain employees to query the base
-- profiles table directly and read sensitive columns (status, is_platform_admin,
-- deactivated_at). All legitimate non-admin reads go through the view below.
-- Idempotent: IF EXISTS guard is safe on first run and on re-run.
DROP POLICY IF EXISTS profiles_select_employee_directory ON public.profiles;


-- ---------------------------------------------------------------------------
-- 3a. Projected view: public.employee_directory (H-2)
--
-- Exposes ONLY id, display_name, role — the minimum needed for co-worker
-- lookups, task-assignee pickers, and team member pickers (FR-05).
-- Does NOT expose: status, is_platform_admin, email, company_id.
--
-- WHERE clause scopes to the caller's company via the JWT claim. The view
-- runs with security_invoker = false (definer semantics, which is the Postgres
-- default for views). We set it explicitly for clarity on Supabase (PG 15).
-- RLS on the underlying profiles table still fires for the definer, but since
-- the view itself applies the company_id filter we are doubly protected.
--
-- Granted to authenticated. Plain employees hit this view, not the base table.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.employee_directory;

CREATE OR REPLACE VIEW public.employee_directory
  WITH (security_invoker = false)
AS
  SELECT
    id,
    display_name,
    role
  FROM public.profiles
  WHERE company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND status != 'deactivated';

COMMENT ON VIEW public.employee_directory IS
  'Safe projection for employee co-worker lookups. Exposes id, display_name, '
  'role only — status and is_platform_admin are intentionally excluded (H-2). '
  'Excludes deactivated profiles. Scoped to caller''s company via JWT claim. '
  'Granted to authenticated. Use this for task-assignee pickers and team '
  'member pickers. Do NOT expose the base profiles table to plain employees.';

REVOKE ALL ON public.employee_directory FROM PUBLIC;
GRANT SELECT ON public.employee_directory TO authenticated;


-- ---------------------------------------------------------------------------
-- 3b. Projected view: public.admin_employee_list (H-2 + Q1)
--
-- Full projection joining public.profiles with auth.users for email.
-- Includes status and deactivated_at for admin management display (EC-5).
-- Granted to service_role ONLY — not accessible via anon or authenticated key.
-- Admin Server Actions use the service-role client to query this view.
--
-- Resolves Q1 (how admins get email alongside profile data): the view JOINs
-- auth.users so the Server Action does not need a separate Auth admin API call
-- just to get email.
--
-- security_invoker = false (definer semantics). The view owner has access to
-- auth.users; the service_role caller inherits this via the view.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.admin_employee_list;

CREATE OR REPLACE VIEW public.admin_employee_list
  WITH (security_invoker = false)
AS
  SELECT
    p.id,
    p.company_id,
    p.display_name,
    p.role,
    p.status,
    p.deactivated_at,
    p.is_platform_admin,
    p.created_at,
    u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id;

COMMENT ON VIEW public.admin_employee_list IS
  'Full projection of profiles + auth.users.email for admin employee management. '
  'Includes status, deactivated_at, is_platform_admin. Granted to service_role '
  'ONLY — not accessible via authenticated or anon key. Admin Server Actions '
  'query this via the service-role client. Resolves Q1 (email without a '
  'separate Auth admin API call). Not company-scoped in the view itself — '
  'the Server Action must apply company_id filter in the query WHERE clause.';

REVOKE ALL ON public.admin_employee_list FROM PUBLIC;
GRANT SELECT ON public.admin_employee_list TO service_role;


-- ---------------------------------------------------------------------------
-- 4. Update the JWT hook to include `status`
--
-- Why: middleware needs to block deactivated sessions without a DB round-trip.
-- We extend the existing custom_access_token_hook function via CREATE OR REPLACE.
-- The Supabase Dashboard hook registration is unchanged (same function signature).
--
-- The hook now injects four claims:
--   company_id        text
--   is_platform_admin text ('true'/'false')
--   role              text ('admin'/'employee')
--   status            text ('active'/'pending'/'deactivated')  <-- NEW
--
-- Middleware usage:
--   const status = session.user.app_metadata?.status;
--   if (status === 'deactivated') redirect('/login?error=deactivated');
--   if (status === 'pending') redirect('/login?error=pending');
--   (See handoff for full middleware contract.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       uuid;
  v_company_id    uuid;
  v_is_platform   boolean;
  v_role          text;
  v_status        text;
  v_claims        jsonb;
  v_app_metadata  jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;

  SELECT
    company_id,
    is_platform_admin,
    role,
    status
  INTO
    v_company_id,
    v_is_platform,
    v_role,
    v_status
  FROM public.profiles
  WHERE id = v_user_id;

  -- If no profile found (race window during invite/signup), return unchanged.
  IF NOT FOUND THEN
    RETURN event;
  END IF;

  v_claims       := event -> 'claims';
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);

  v_app_metadata := v_app_metadata || jsonb_build_object(
    'company_id',        v_company_id::text,
    'is_platform_admin', v_is_platform::text,
    'role',              v_role,
    'status',            v_status
  );

  v_claims := v_claims || jsonb_build_object('app_metadata', v_app_metadata);

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase custom_access_token hook. Injects company_id, is_platform_admin, role, '
  'and status from profiles into JWT app_metadata so RLS policies and middleware '
  'can read them without extra queries. status added in 20260816000002 to allow '
  'middleware to block deactivated sessions at JWT-read time. '
  'Must be registered in the Supabase Dashboard under Authentication -> Hooks.';

-- Re-apply grants (CREATE OR REPLACE preserves them in Postgres, but explicit
-- re-grant is defensive and documents intent clearly).
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- 5. Helper: get_profile_status — REMOVED (M-1)
--
-- Reviewer finding M-1: this helper was defined but granted to no role and
-- called by no external caller. The RPCs below are themselves SECURITY DEFINER
-- and read profiles directly without needing an intermediate helper. Keeping
-- it risked misleading future maintainers into thinking it was a safe RLS
-- bypass path for SECURITY INVOKER callers (it would not be). Deleted.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 6. RPC: change_employee_role(p_target_profile_id, p_new_role)
--
-- Promotes or demotes a profile between 'admin' and 'employee'.
--
-- Guards enforced at the DB layer (defense-in-depth beyond Server Action checks):
--   G1. Caller must be a company admin (role = 'admin' in JWT) OR platform admin.
--   G2. For non-platform-admin callers: target must be in the same company (JWT).
--   G3. Caller cannot modify their own role (self-demotion lockout).
--   G4. p_new_role must be 'admin' or 'employee' (CHECK is on the column, but
--       we validate early to return a clear error rather than a constraint violation).
--   G5. Last-admin lockout: if demoting to 'employee', there must be at least
--       one OTHER profile in the company with role = 'admin' after the change.
--       Prevents a company from becoming admin-less.
--
-- Returns jsonb:
--   { "success": true, "old_role": "...", "new_role": "..." }
--   or raises an exception with a descriptive message.
--
-- Called via service-role only (GRANT to service_role, REVOKE from PUBLIC).
-- The Server Action is the caller; it uses the service-role client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_employee_role(
  p_target_profile_id  uuid,
  p_new_role           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id       uuid;
  v_caller_company  uuid;
  v_caller_role     text;
  v_is_platform     boolean;
  v_target_company  uuid;
  v_current_role    text;
  v_admin_count     bigint;
BEGIN
  -- Resolve caller identity from the session.
  v_caller_id      := auth.uid();
  v_caller_company := (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid;
  v_caller_role    := (auth.jwt() -> 'app_metadata' ->> 'role')::text;
  v_is_platform    := COALESCE(
                        (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
                        false
                      );

  -- G4: validate new role value before any further work.
  IF p_new_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'invalid_role_value: p_new_role must be ''admin'' or ''employee''. Got: %', p_new_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- G1: caller must be a company admin or platform admin.
  IF v_caller_role != 'admin' AND NOT v_is_platform THEN
    RAISE EXCEPTION 'permission_denied: caller does not have admin privileges'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G3: self-modification check. Platform admins are exempt per PRD FR-03.
  IF v_caller_id = p_target_profile_id AND NOT v_is_platform THEN
    RAISE EXCEPTION 'self_modification_denied: a company admin cannot change their own role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read target's current state (bypassing RLS via SECURITY DEFINER context).
  SELECT company_id, role
  INTO   v_target_company, v_current_role
  FROM   public.profiles
  WHERE  id = p_target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found: profile % does not exist', p_target_profile_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- G2: company scope check for non-platform admins.
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- No-op: role is already the target value.
  IF v_current_role = p_new_role THEN
    RETURN jsonb_build_object(
      'success',  true,
      'old_role', v_current_role,
      'new_role', p_new_role,
      'noop',     true
    );
  END IF;

  -- G5: last-admin lockout. Only relevant when demoting (new role = 'employee').
  -- L-1 fix: must count only non-deactivated admins, matching G7 in deactivate_employee.
  -- Without this filter, a deactivated admin counts toward the "other admins" tally,
  -- allowing a company to reach zero *active* admins via demotion.
  IF p_new_role = 'employee' THEN
    SELECT COUNT(*)
    INTO   v_admin_count
    FROM   public.profiles
    WHERE  company_id = v_target_company
      AND  role       = 'admin'
      AND  status    != 'deactivated'   -- L-1: only count active/pending admins
      AND  id        != p_target_profile_id;  -- count admins OTHER than the target

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'last_admin_lockout: cannot demote the last admin of company %', v_target_company
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Perform the role update.
  UPDATE public.profiles
  SET    role = p_new_role
  WHERE  id   = p_target_profile_id;

  RETURN jsonb_build_object(
    'success',  true,
    'old_role', v_current_role,
    'new_role', p_new_role,
    'noop',     false
  );
END;
$$;

COMMENT ON FUNCTION public.change_employee_role(uuid, text) IS
  'Promotes or demotes a profile role between ''admin'' and ''employee''. '
  'Enforces: caller must be admin or platform admin (G1), company scope (G2), '
  'no self-demotion for non-platform admins (G3), last-admin lockout (G5). '
  'SECURITY DEFINER — must be called via service-role client only. ADR-0015.';

REVOKE ALL ON FUNCTION public.change_employee_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_employee_role(uuid, text) TO service_role;


-- ---------------------------------------------------------------------------
-- 7. RPC: deactivate_employee(p_target_profile_id)
--
-- Sets profiles.status = 'deactivated' and records deactivated_at = now()
-- for the target profile (M-3 audit requirement).
-- Note: the actual Supabase Auth account ban (auth.admin.banUser) is done
-- by the Server Action via the service-role client AFTER calling this RPC.
-- DB is the authority — Auth ban is the trailing side effect.
-- The Server Action orchestrates both steps.
--
-- Guards:
--   G1. Caller must be company admin or platform admin.
--   G2. For non-platform admins: target must be in same company.
--   G3. Caller cannot deactivate themselves.
--   G6. Cannot deactivate a profile that is already 'deactivated' (no-op friendly).
--   G_H1. Cannot deactivate a 'pending' profile — must revoke the invitation instead
--         (H-1 fix). Falling through to deactivation on a pending profile creates a
--         permanently unusable account (invite completes → profile is deactivated →
--         middleware blocks).
--   G7. Deactivating the last admin is blocked (same last-admin concern as role
--       demotion — if the only admin is deactivated, the company loses management).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deactivate_employee(
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id       uuid;
  v_caller_company  uuid;
  v_caller_role     text;
  v_is_platform     boolean;
  v_target_company  uuid;
  v_target_role     text;
  v_current_status  text;
  v_admin_count     bigint;
BEGIN
  v_caller_id      := auth.uid();
  v_caller_company := (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid;
  v_caller_role    := (auth.jwt() -> 'app_metadata' ->> 'role')::text;
  v_is_platform    := COALESCE(
                        (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
                        false
                      );

  -- G1
  IF v_caller_role != 'admin' AND NOT v_is_platform THEN
    RAISE EXCEPTION 'permission_denied: caller does not have admin privileges'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G3
  IF v_caller_id = p_target_profile_id THEN
    RAISE EXCEPTION 'self_deactivation_denied: a user cannot deactivate their own account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read target state.
  SELECT company_id, role, status
  INTO   v_target_company, v_target_role, v_current_status
  FROM   public.profiles
  WHERE  id = p_target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found: profile % does not exist', p_target_profile_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- G2
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G6: already deactivated — treat as no-op.
  IF v_current_status = 'deactivated' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status',  'deactivated',
      'noop',    true
    );
  END IF;

  -- G_H1 (H-1): pending profiles cannot be deactivated.
  -- A pending profile is one where the user has been invited but has not yet
  -- accepted. Deactivating it creates an account that can never be activated
  -- (the invite callback calls activate_invited_employee which would find
  -- status = 'deactivated' and raise, blocking the user forever).
  -- The correct action for a pending profile is to revoke the invitation via
  -- auth.admin.deleteUser, which also deletes the pending profile row.
  IF v_current_status = 'pending' THEN
    RAISE EXCEPTION 'cannot_deactivate_pending: cannot deactivate a pending profile. '
      'Revoke the invitation instead (auth.admin.deleteUser on the invited user).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- G7: last-admin lockout for deactivation.
  IF v_target_role = 'admin' THEN
    SELECT COUNT(*)
    INTO   v_admin_count
    FROM   public.profiles
    WHERE  company_id = v_target_company
      AND  role       = 'admin'
      AND  status    != 'deactivated'
      AND  id        != p_target_profile_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'last_admin_lockout: cannot deactivate the last active admin of company %', v_target_company
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- M-3: set status and record deactivated_at for audit trail.
  UPDATE public.profiles
  SET    status        = 'deactivated',
         deactivated_at = now()
  WHERE  id            = p_target_profile_id;

  RETURN jsonb_build_object(
    'success',         true,
    'previous_status', v_current_status,
    'status',          'deactivated',
    'noop',            false
  );
END;
$$;

COMMENT ON FUNCTION public.deactivate_employee(uuid) IS
  'Sets profiles.status = ''deactivated'' and records deactivated_at timestamp. '
  'Does NOT perform the Supabase Auth account ban — that is the Server Action''s '
  'responsibility (requires service-role Auth admin API call, done AFTER this RPC). '
  'DB is authority; Auth ban is the trailing side effect. '
  'Enforces: admin caller (G1), company scope (G2), no self-deactivation (G3), '
  'cannot deactivate pending profiles (H-1), last-admin lockout (G7). '
  'SECURITY DEFINER — service-role client only. ADR-0015.';

REVOKE ALL ON FUNCTION public.deactivate_employee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_employee(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 8. RPC: reactivate_employee(p_target_profile_id)
--
-- Sets profiles.status = 'active' for the target profile.
-- Counterpart to deactivate_employee. The Server Action also calls
-- auth.admin.updateUserById({ ban_duration: 'none' }) to unban the Auth account.
--
-- Guards:
--   G1. Caller must be company admin or platform admin.
--   G2. For non-platform admins: target must be in same company.
--   G8. Cannot reactivate a profile that is already 'active' or 'pending'
--       (no-op for 'active'; 'pending' users have not yet accepted their invite —
--       reactivation on a pending profile is a programming error in MVP).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reactivate_employee(
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_company  uuid;
  v_caller_role     text;
  v_is_platform     boolean;
  v_target_company  uuid;
  v_current_status  text;
BEGIN
  v_caller_company := (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid;
  v_caller_role    := (auth.jwt() -> 'app_metadata' ->> 'role')::text;
  v_is_platform    := COALESCE(
                        (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
                        false
                      );

  -- G1
  IF v_caller_role != 'admin' AND NOT v_is_platform THEN
    RAISE EXCEPTION 'permission_denied: caller does not have admin privileges'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read target.
  SELECT company_id, status
  INTO   v_target_company, v_current_status
  FROM   public.profiles
  WHERE  id = p_target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found: profile % does not exist', p_target_profile_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- G2
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G8: only 'deactivated' profiles can be reactivated.
  IF v_current_status = 'active' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status',  'active',
      'noop',    true
    );
  END IF;

  IF v_current_status = 'pending' THEN
    RAISE EXCEPTION 'invalid_state: cannot reactivate a pending profile (status = ''pending''). '
      'Pending profiles become active when the user accepts their invitation.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- M-3: clear deactivated_at when reactivating (status constraint enforces NULL
  -- when status != 'deactivated'; explicit clear avoids a constraint violation).
  UPDATE public.profiles
  SET    status         = 'active',
         deactivated_at = NULL
  WHERE  id             = p_target_profile_id;

  RETURN jsonb_build_object(
    'success',         true,
    'previous_status', v_current_status,
    'status',          'active',
    'noop',            false
  );
END;
$$;

COMMENT ON FUNCTION public.reactivate_employee(uuid) IS
  'Sets profiles.status = ''active'' and clears deactivated_at. '
  'Does NOT unban the Supabase Auth account — that is the Server Action''s '
  'responsibility (call auth.admin.updateUserById ban_duration=none AFTER this RPC). '
  'DB is authority; Auth unban is the trailing side effect. '
  'Enforces: admin caller (G1), company scope (G2). Reactivating an already-active '
  'profile is a no-op. Reactivating a pending profile raises invalid_parameter_value. '
  'SECURITY DEFINER — service-role client only. ADR-0015.';

REVOKE ALL ON FUNCTION public.reactivate_employee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reactivate_employee(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 9. RPC: activate_invited_employee() (Q2)
--
-- Self-activation RPC called by the invited user from their own browser session
-- immediately after accepting the invite and creating a password. No parameters —
-- reads auth.uid() internally so the user cannot spoof the target.
--
-- Transition: pending → active (only).
-- - If already active: idempotent no-op (safe for callback retries).
-- - If deactivated: raises invalid_parameter_value. A deactivated user who was
--   re-sent an invite token must NOT be able to self-reactivate — an admin must
--   explicitly call reactivate_employee first.
--
-- Caller: authenticated (the invited user's session, NOT service-role).
-- The backend accept-invite Server Action calls:
--   supabase.rpc('activate_invited_employee')  -- from the browser session
-- NOT from the service-role client.
--
-- SECURITY DEFINER: bypasses RLS to update own profile row without exposing a
-- writable authenticated path on the base profiles table. auth.uid() scoping
-- ensures the function can only modify the caller's own row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_invited_employee()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id      uuid;
  v_current_status text;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated: activate_invited_employee requires an authenticated session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read own profile status (SECURITY DEFINER context bypasses RLS).
  SELECT status
  INTO   v_current_status
  FROM   public.profiles
  WHERE  id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found: no profile row exists for the current user (id: %)', v_caller_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotent: already active is a safe no-op (invite callback may retry).
  IF v_current_status = 'active' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status',  'active',
      'noop',    true
    );
  END IF;

  -- Deactivated users must NOT self-reactivate via an invite token.
  -- An admin must call reactivate_employee first.
  IF v_current_status = 'deactivated' THEN
    RAISE EXCEPTION 'cannot_activate_deactivated: this account has been deactivated by an admin. '
      'Contact your administrator to restore access.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only remaining state is 'pending' — perform the transition.
  UPDATE public.profiles
  SET    status = 'active'
  WHERE  id     = v_caller_id;

  RETURN jsonb_build_object(
    'success',         true,
    'previous_status', v_current_status,
    'status',          'active',
    'noop',            false
  );
END;
$$;

COMMENT ON FUNCTION public.activate_invited_employee() IS
  'Self-activation RPC for invited users. Transitions own profile from '
  '''pending'' to ''active'' upon invite acceptance. No parameters — target is '
  'always auth.uid() (prevents spoofing). Idempotent on already-active. Raises '
  'on deactivated (admin must reactivate first). '
  'Granted to authenticated (NOT service_role) — called from the browser session '
  'in the accept-invite callback. SECURITY DEFINER. ADR-0015.';

REVOKE ALL ON FUNCTION public.activate_invited_employee() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_invited_employee() TO authenticated;


-- =============================================================================
-- End of migration 20260816000002_employees_schema.sql
-- =============================================================================
