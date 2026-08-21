-- =============================================================================
-- Migration: 20260819000002_employee_lifecycle_deletion.sql
-- Purpose:   Employee lifecycle deletion module — Phase 1 (PRD 05).
--            Implements soft-delete, hard-delete, cancel-invite, and
--            cancel-scheduled-deletion operations at the database layer.
--
-- Depends on (must be applied in this exact order):
--   20260802000001_auth_schema.sql            — public.profiles
--   20260802000002_jwt_sync_hook.sql          — custom_access_token_hook
--   20260809000001_teams_schema.sql           — public.team_members, public.boards
--   20260816000002_employees_schema.sql       — profiles.status, deactivated_at, RPCs
--   20260818000001_grant_service_role_table_privileges.sql — ALTER DEFAULT PRIVILEGES
--   20260819000001_team_members_surrogate_pk.sql           — team_members.id PK,
--                                                            boards.created_by
--
-- What this migration adds:
--   1. profiles.deletion_scheduled_at — soft-delete grace window column + CHECK.
--   2. Partial index on profiles.deletion_scheduled_at for the cron query.
--   3. employee_lifecycle_log table — append-only audit log.
--   4. RLS on employee_lifecycle_log (SELECT for admins; no authenticated writes).
--   5. pg_cron extension.
--   6. RPCs (all SECURITY DEFINER, service_role only unless noted):
--        soft_delete_employee         — initiates 24h grace window
--        hard_delete_employee         — immediate irreversible deletion
--        cancel_scheduled_deletion    — aborts grace window, clears deletion_scheduled_at
--        cancel_invite                — removes pending profile row (S-3)
--        _promote_scheduled_deletions — internal cron function (B-1)
--   7. pg_cron job: promote-scheduled-deletions (every 5 minutes).
--
-- Rollback considerations (dev/staging ONLY — NEVER on production with live data):
--   Prerequisites: 20260819000001 must be rolled back AFTER this migration.
--   Step 1 — roll back this migration:
--     SELECT cron.unschedule('promote-scheduled-deletions');
--     DROP FUNCTION IF EXISTS public._promote_scheduled_deletions() CASCADE;
--     DROP FUNCTION IF EXISTS public.cancel_invite(uuid) CASCADE;
--     DROP FUNCTION IF EXISTS public.cancel_scheduled_deletion(uuid) CASCADE;
--     DROP FUNCTION IF EXISTS public.hard_delete_employee(uuid) CASCADE;
--     DROP FUNCTION IF EXISTS public.soft_delete_employee(uuid) CASCADE;
--     DROP TABLE IF EXISTS public.employee_lifecycle_log CASCADE;
--     ALTER TABLE public.profiles DROP COLUMN IF EXISTS deletion_scheduled_at;
--     DROP EXTENSION IF EXISTS pg_cron;
--   Step 2 — then roll back 20260819000001 (see that file's rollback stub).
--
-- Tenancy note:
--   employee_lifecycle_log carries target_company_id (denormalized at write time)
--   so log rows remain queryable after the target profile is deleted. RLS on the
--   log table uses target_company_id to scope company-admin reads. Platform admins
--   can read all rows. No authenticated INSERT/UPDATE/DELETE policy (service-role
--   only for writes, per the append-only design).
--
-- Grants note:
--   ALTER DEFAULT PRIVILEGES in 20260818000001 means any table created in public
--   by the postgres role automatically receives GRANT ALL to service_role. This
--   covers employee_lifecycle_log. A smoke test is documented below to verify.
--
-- pg_cron note:
--   pg_cron must be enabled in the Supabase Dashboard under
--   Database > Extensions > pg_cron BEFORE this migration runs in production.
--   The CREATE EXTENSION IF NOT EXISTS statement will succeed if the extension
--   is already installed (from the Dashboard) or will install it (if the role
--   has permission). On Supabase Pro the postgres role has this permission.
--   On lower plans the extension must be enabled via the Dashboard first.
--   See backend handoff Deploy Notes section for the full procedure.
-- =============================================================================


-- =============================================================================
-- 1. profiles.deletion_scheduled_at column + CHECK constraint (RD-01)
--
-- Design decisions:
--   - TIMESTAMPTZ NULL: NULL means no scheduled deletion pending.
--     A non-null value is the expiry timestamp of the 24-hour grace window.
--   - CHECK constraint (RD-01, confirmed): only active profiles can have a
--     deletion scheduled. A deactivated profile must be reactivated before
--     soft-delete. Hard delete of a deactivated profile is permitted (no guard
--     blocks deletion of a deactivated profile; the column simply stays NULL
--     because deactivated profiles skip the soft-delete path entirely).
--   - Interaction with profiles_deactivated_at_status_check: a profile with
--     status = 'deactivated' must have deactivated_at IS NOT NULL (existing
--     constraint). Our new constraint requires deletion_scheduled_at IS NULL
--     unless status = 'active'. These two constraints are not in conflict:
--       - 'active':      deletion_scheduled_at can be NULL or non-null. deactivated_at must be NULL.
--       - 'deactivated': deletion_scheduled_at MUST be NULL (new constraint). deactivated_at must be non-null.
--       - 'pending':     deletion_scheduled_at MUST be NULL (new constraint). deactivated_at must be NULL.
--     No reachable status value violates both constraints simultaneously.
--   - This column is never written directly by an authenticated client. Only
--     SECURITY DEFINER RPCs (soft_delete_employee, cancel_scheduled_deletion)
--     and the internal cron function write it.
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz NULL;

-- Add the CHECK constraint with idempotency guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname   = 'profiles_deletion_scheduled_at_check'
      AND  conrelid  = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_deletion_scheduled_at_check
      CHECK (
        (deletion_scheduled_at IS NULL)
        OR
        (status = 'active')
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.profiles.deletion_scheduled_at IS
  'Soft-delete grace window expiry timestamp. NULL = no scheduled deletion. '
  'Non-null = profile is in the 24-hour soft-delete grace window; value is the '
  'UTC timestamp at which the hard delete will be promoted by the pg_cron job. '
  'CHECK constraint (RD-01): deletion_scheduled_at IS NOT NULL implies status = ''active''. '
  'Deactivated profiles must be reactivated before soft-delete. Hard-delete of '
  'a deactivated profile is permitted (no scheduled deletion path for deactivated '
  'profiles — deletion_scheduled_at remains NULL). Written only by SECURITY '
  'DEFINER RPCs: soft_delete_employee (sets value), cancel_scheduled_deletion '
  '(clears to NULL). Never directly writable from an authenticated client session. '
  'Added in 20260819000002 per PRD 05 Data Model and RD-01.';


-- =============================================================================
-- 2. Partial index on profiles.deletion_scheduled_at (reviewer finding N-2)
--
-- Query pattern: _promote_scheduled_deletions() runs every 5 minutes and
-- iterates: SELECT id, is_platform_admin FROM public.profiles
--            WHERE deletion_scheduled_at IS NOT NULL
--              AND deletion_scheduled_at < now()
--
-- A partial index WHERE deletion_scheduled_at IS NOT NULL scans ONLY the rows
-- in the soft-delete grace window (expected to be very few at any given time).
-- Full-table scans of profiles for this cron query would be disproportionately
-- expensive as the profiles table grows. The partial index keeps the cron query
-- O(rows_in_grace_window) rather than O(total_profiles).
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_deletion_scheduled_at
  ON public.profiles (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;

COMMENT ON INDEX public.idx_profiles_deletion_scheduled_at IS
  'Partial index supporting the _promote_scheduled_deletions() cron function. '
  'Scans only rows where deletion_scheduled_at IS NOT NULL (profiles in the '
  'soft-delete grace window). Expected cardinality: very low. Without this index '
  'the cron query would full-scan profiles every 5 minutes. WHERE deletion_scheduled_at '
  'IS NOT NULL means NULL rows (the vast majority) are excluded from the index '
  'entirely, keeping it near-zero in size under normal operating conditions. '
  'Added in 20260819000002 per reviewer finding N-2.';


-- =============================================================================
-- 3. employee_lifecycle_log table
--
-- Design decisions:
--   - append-only: no UPDATE or DELETE policy for authenticated role.
--     Service-role retains physical access for future retention-sweep migrations.
--   - actor_profile_id and target_profile_id: FK to profiles.id with
--     ON DELETE SET NULL. Log rows must survive profile deletion — the whole
--     point of the log is to preserve the audit trail after the fact.
--   - target_email and target_company_id: denormalized at write time (N-3).
--     After a profile is deleted, target_profile_id becomes NULL and the profile
--     row is gone. Without these denormalized copies, the log row would lose its
--     subject identity. This is intentional and documented in the table comment.
--   - action CHECK constraint: exactly the 10 lifecycle event values from PRD 05.
--   - created_at only (no updated_at): log rows are never updated.
--   - No company_id column on the log itself: tenancy scoping for RLS is done
--     via target_company_id (which is the affected employee's company).
--   - Service-role grants: inherited from ALTER DEFAULT PRIVILEGES in
--     20260818000001. See smoke test instructions at the end of this migration.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.employee_lifecycle_log (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  actor_profile_id  uuid        NULL,
  target_profile_id uuid        NULL,
  target_email      text        NOT NULL,
  target_company_id uuid        NOT NULL,
  action            text        NOT NULL,
  metadata          jsonb       NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT employee_lifecycle_log_pkey
    PRIMARY KEY (id),

  -- actor_profile_id ON DELETE SET NULL: log rows survive actor profile deletion.
  -- An admin who deleted their own account before all log entries aged out will
  -- show as actor_profile_id = NULL in the log — acceptable tombstone behavior.
  CONSTRAINT employee_lifecycle_log_actor_fkey
    FOREIGN KEY (actor_profile_id)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL,

  -- target_profile_id ON DELETE SET NULL: log rows survive target profile deletion.
  -- After a hard delete, the log row remains with target_profile_id = NULL.
  -- target_email and target_company_id preserve the subject identity post-deletion.
  CONSTRAINT employee_lifecycle_log_target_fkey
    FOREIGN KEY (target_profile_id)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL,

  -- FK to companies: target_company_id is the tenant scope for RLS.
  -- ON DELETE RESTRICT: a company row should not be deletable while log entries
  -- reference it. In practice companies are never deleted in MVP, but RESTRICT
  -- is the safe default for a tenant-root reference.
  CONSTRAINT employee_lifecycle_log_target_company_fkey
    FOREIGN KEY (target_company_id)
    REFERENCES public.companies (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  -- Validate action values at the database level. CHECK on text rather than
  -- an enum type — consistent with profiles.role and profiles.status pattern
  -- (ALTER TYPE is lock-heavy; adding a new action value is a simple CHECK change).
  CONSTRAINT employee_lifecycle_log_action_check
    CHECK (action IN (
      'invite_sent',
      'invite_cancelled',
      'invite_resent',
      'invite_accepted',
      'role_changed',
      'deactivated',
      'reactivated',
      'soft_deleted',
      'hard_deleted',
      'deletion_undone'
    )),

  -- target_email must not be empty (basic sanity — the email was valid at write time).
  CONSTRAINT employee_lifecycle_log_target_email_check
    CHECK (char_length(trim(target_email)) > 0)
);

COMMENT ON TABLE public.employee_lifecycle_log IS
  'Append-only audit log for all employee lifecycle events. '
  'Rows are written by SECURITY DEFINER RPCs and service-role Server Actions. '
  'No authenticated INSERT/UPDATE/DELETE path exists. Service-role retains full '
  'access for future retention-sweep migrations. '
  'DENORMALIZATION NOTE (reviewer N-3): target_email and target_company_id are '
  'captured at write time (denormalized) specifically because they must survive '
  'profile deletion. After a hard delete, target_profile_id becomes NULL (FK '
  'ON DELETE SET NULL) and the profiles row is gone. target_email and '
  'target_company_id are the only remaining identifiers for the audit subject. '
  'This denormalization is intentional, documented, and irreversible by design. '
  'The log is accurate from the point migration 20260819000002 goes live. '
  'Pre-existing lifecycle events (invites, deactivations before this migration) '
  'are not backfilled — see PRD 05 R-04.';

COMMENT ON COLUMN public.employee_lifecycle_log.actor_profile_id IS
  'Profile ID of the admin who performed the action. NULL if the actor''s profile '
  'was deleted before log entries were reviewed. ON DELETE SET NULL.';

COMMENT ON COLUMN public.employee_lifecycle_log.target_profile_id IS
  'Profile ID of the affected employee at time of logging. NULL after the '
  'target profile is hard-deleted (FK ON DELETE SET NULL). Use target_email '
  'to identify the subject after deletion.';

COMMENT ON COLUMN public.employee_lifecycle_log.target_email IS
  'Email address of the affected employee, captured at action time. Preserved '
  'for post-deletion queryability. Denormalized — see table comment.';

COMMENT ON COLUMN public.employee_lifecycle_log.target_company_id IS
  'Company of the affected employee, captured at action time. Used for RLS '
  'scoping: company admins can read log entries for their own company_id. '
  'Preserved after profile deletion. Denormalized — see table comment.';

COMMENT ON COLUMN public.employee_lifecycle_log.action IS
  'Lifecycle event type. One of: invite_sent, invite_cancelled, invite_resent, '
  'invite_accepted, role_changed, deactivated, reactivated, soft_deleted, '
  'hard_deleted, deletion_undone. Enforced by CHECK constraint.';

COMMENT ON COLUMN public.employee_lifecycle_log.metadata IS
  'Optional event context as JSONB. Examples: '
  '{ "old_role": "employee", "new_role": "admin" } for role_changed; '
  '{ "deletion_scheduled_at": "2026-08-20T12:00:00Z" } for soft_deleted. '
  'NULL for events with no additional context.';

COMMENT ON COLUMN public.employee_lifecycle_log.created_at IS
  'Timestamp when the log entry was written (UTC). Never updated. '
  'Append-only: no UPDATE path exists for this column.';


-- ---------------------------------------------------------------------------
-- Indexes on employee_lifecycle_log
--
-- Query pattern L1: Company admin reads their company's log.
--   SELECT * FROM employee_lifecycle_log
--   WHERE target_company_id = $1
--   ORDER BY created_at DESC
--   Composite index (target_company_id, created_at DESC) covers this.
--
-- Query pattern L2: Find all log entries for a specific target employee.
--   SELECT * FROM employee_lifecycle_log
--   WHERE target_profile_id = $1
--   ORDER BY created_at DESC
--   Single-column index on target_profile_id covers this.
-- ---------------------------------------------------------------------------

-- L1: company admin reads their company's audit log (most common query).
CREATE INDEX IF NOT EXISTS idx_employee_lifecycle_log_company_created
  ON public.employee_lifecycle_log (target_company_id, created_at DESC);

COMMENT ON INDEX public.idx_employee_lifecycle_log_company_created IS
  'Supports company admin audit log reads: WHERE target_company_id = $1 ORDER BY '
  'created_at DESC. target_company_id is the leading column (most selective '
  'in the RLS predicate). created_at DESC matches the natural sort for a log UI.';

-- L2: lookup all log entries for a specific employee (used after investigating
-- a deletion complaint or when reviewing a specific user's history).
CREATE INDEX IF NOT EXISTS idx_employee_lifecycle_log_target_profile
  ON public.employee_lifecycle_log (target_profile_id)
  WHERE target_profile_id IS NOT NULL;

COMMENT ON INDEX public.idx_employee_lifecycle_log_target_profile IS
  'Supports per-employee log lookup: WHERE target_profile_id = $1. '
  'Partial index: excludes NULL rows (hard-deleted employees whose target_profile_id '
  'was set to NULL by FK SET NULL). Those rows are still queryable via target_email '
  'or target_company_id. Added for employee-specific audit investigations.';


-- =============================================================================
-- 4. RLS on employee_lifecycle_log
--
-- Access model:
--   SELECT: company admin reads entries for their own company (target_company_id
--           matches JWT company_id AND JWT role = 'admin').
--           Platform admin reads all entries.
--   INSERT: no authenticated policy — only service-role writes to this table.
--           (Service-role bypasses RLS; no INSERT policy means authenticated
--           users physically cannot insert rows even if they try.)
--   UPDATE: no policy — append-only design.
--   DELETE: no policy — append-only design. Service-role retains DELETE access
--           (bypasses RLS) for future retention-sweep migrations.
-- =============================================================================
ALTER TABLE public.employee_lifecycle_log ENABLE ROW LEVEL SECURITY;

-- SELECT: company admin reads log entries for their own company.
-- Uses target_company_id (denormalized) for the tenant scope check — this is
-- the ONLY reliable field after the target profile is deleted.
CREATE POLICY employee_lifecycle_log_select_company_admin
  ON public.employee_lifecycle_log
  FOR SELECT
  TO authenticated
  USING (
    target_company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- SELECT: platform admin reads all log entries across all companies.
CREATE POLICY employee_lifecycle_log_select_platform_admin
  ON public.employee_lifecycle_log
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- No INSERT/UPDATE/DELETE policies for authenticated role.
-- INSERT: service_role only (bypasses RLS — no policy needed).
-- UPDATE: blocked — append-only.
-- DELETE: blocked from authenticated — service_role retains access for retention sweeps.


-- ---------------------------------------------------------------------------
-- Grants on employee_lifecycle_log
--
-- REVOKE from PUBLIC (defense-in-depth — consistent with RPC pattern).
-- GRANT SELECT to authenticated so the RLS policies above can be evaluated.
-- (Without a SELECT grant, PostgreSQL would not even reach the RLS policy check.)
-- Service-role grants are inherited from ALTER DEFAULT PRIVILEGES in
-- 20260818000001 (every new table in public created by postgres role gets
-- GRANT ALL to service_role automatically).
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.employee_lifecycle_log FROM PUBLIC;
GRANT SELECT ON public.employee_lifecycle_log TO authenticated;

-- =============================================================================
-- Smoke test instructions (run manually after applying this migration):
--
-- Test 1: Verify service_role can INSERT into employee_lifecycle_log.
--   BEGIN;
--   SET LOCAL ROLE service_role;  -- or run as service_role session
--   INSERT INTO public.employee_lifecycle_log
--     (target_email, target_company_id, action)
--   VALUES
--     ('smoke@test.invalid', '00000000-0000-0000-0000-000000000001', 'invite_sent');
--   ROLLBACK;
--   Expected: INSERT succeeds; ROLLBACK cleans up. Confirms default privileges.
--
-- Test 2: Verify pg_cron job was scheduled.
--   SELECT jobname, schedule, command FROM cron.job
--   WHERE jobname = 'promote-scheduled-deletions';
--   Expected: 1 row returned.
--
-- Test 3: Verify pg_cron extension is installed.
--   SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
--   Expected: 1 row with extname = 'pg_cron'.
-- =============================================================================


-- =============================================================================
-- 5. pg_cron extension
--
-- RD-05 (confirmed): pg_cron is available on the Supabase plan.
-- The extension must also be enabled via Supabase Dashboard > Database >
-- Extensions > pg_cron before this migration runs in production.
-- CREATE EXTENSION IF NOT EXISTS is idempotent (safe to re-run).
-- Supabase installs pg_cron into the extensions schema.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- =============================================================================
-- 6. RPCs
--
-- Pattern (matches existing lifecycle RPCs exactly):
--   - LANGUAGE plpgsql
--   - SECURITY DEFINER
--   - SET search_path = ''
--   - Guards raise typed exceptions with ERRCODE
--   - REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO service_role
--   - COMMENT ON FUNCTION
--
-- Guard numbering is consistent with PRD 05 API Surface section.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 6a. RPC: soft_delete_employee(p_target_profile_id uuid) RETURNS jsonb
--
-- Initiates the 24-hour soft-delete grace window for an active employee.
-- Sets deletion_scheduled_at = now() + interval '24 hours'.
-- Does NOT ban the Supabase Auth account — that is the Server Action's
-- responsibility (call auth.admin.banUser AFTER this RPC succeeds, per RD-02).
-- Writes 'soft_deleted' log entry with scheduled_at in metadata.
--
-- Guards:
--   G1. Caller must be company admin or platform admin.
--   G2. For non-platform admins: target must be in same company.
--   G3. If caller is deleting themselves: another active admin must exist.
--   G7. Target must not be a platform admin.
--   G14. Target status must be 'active' (RD-01).
--   G15. Target status must not be 'pending' (FR-19) — use cancel_invite instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_employee(
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id           uuid;
  v_caller_company      uuid;
  v_caller_role         text;
  v_is_platform         boolean;
  v_target_company      uuid;
  v_target_status       text;
  v_target_is_platform  boolean;
  v_target_email        text;
  v_admin_count         bigint;
  v_scheduled_at        timestamptz;
BEGIN
  -- Resolve caller identity from the live session JWT.
  v_caller_id      := auth.uid();
  v_caller_company := (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid;
  v_caller_role    := (auth.jwt() -> 'app_metadata' ->> 'role')::text;
  v_is_platform    := COALESCE(
                        (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean,
                        false
                      );

  -- G1: caller must be company admin or platform admin.
  IF v_caller_role != 'admin' AND NOT v_is_platform THEN
    RAISE EXCEPTION 'permission_denied: caller does not have admin privileges'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read target state (SECURITY DEFINER bypasses RLS for this SELECT).
  SELECT p.company_id, p.status, p.is_platform_admin, u.email
  INTO   v_target_company, v_target_status, v_target_is_platform, v_target_email
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id = p_target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found: profile % does not exist', p_target_profile_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- G2: company scope check for non-platform admins.
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G7: platform admins cannot be deleted.
  IF v_target_is_platform THEN
    RAISE EXCEPTION 'platform_admin_protected: platform admin accounts cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G15: pending profiles must be cancelled via cancel_invite, not soft-deleted.
  IF v_target_status = 'pending' THEN
    RAISE EXCEPTION 'cannot_delete_pending: cancel the invitation instead'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- G14: only active profiles can be soft-deleted (RD-01).
  IF v_target_status != 'active' THEN
    RAISE EXCEPTION 'invalid_state_for_soft_delete: only active employees can be scheduled for deletion (current status: %)', v_target_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- G3: last-admin lockout — caller cannot soft-delete themselves if they are
  -- the last active, non-platform admin in the company.
  IF v_caller_id = p_target_profile_id THEN
    SELECT COUNT(*)
    INTO   v_admin_count
    FROM   public.profiles
    WHERE  company_id = v_target_company
      AND  role       = 'admin'
      AND  status    != 'deactivated'
      AND  id        != p_target_profile_id;  -- count OTHER active admins

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'last_admin_lockout: you must promote another admin before scheduling your own account for deletion'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Set the grace window expiry.
  v_scheduled_at := now() + interval '24 hours';

  -- Update the target profile.
  UPDATE public.profiles
  SET    deletion_scheduled_at = v_scheduled_at
  WHERE  id = p_target_profile_id;

  -- Write audit log entry.
  -- actor_profile_id: v_caller_id (the admin who initiated soft-delete).
  -- target_profile_id: p_target_profile_id (still exists at this point).
  INSERT INTO public.employee_lifecycle_log
    (actor_profile_id, target_profile_id, target_email, target_company_id, action, metadata)
  VALUES
    (
      v_caller_id,
      p_target_profile_id,
      v_target_email,
      v_target_company,
      'soft_deleted',
      jsonb_build_object('deletion_scheduled_at', v_scheduled_at::text)
    );

  RETURN jsonb_build_object(
    'success',              true,
    'deletion_scheduled_at', v_scheduled_at::text
  );
END;
$$;

COMMENT ON FUNCTION public.soft_delete_employee(uuid) IS
  'Initiates the 24-hour soft-delete grace window for an active employee. '
  'Sets profiles.deletion_scheduled_at = now() + 24h. '
  'Does NOT ban the Auth account — the Server Action must call auth.admin.banUser '
  'AFTER this RPC succeeds (RD-02). DB is the authority; Auth ban is the trailing '
  'side effect. Writes ''soft_deleted'' audit log entry. '
  'Guards: admin caller (G1), company scope (G2), last-admin lockout for self (G3), '
  'platform admin protection (G7), active-only target (G14), not-pending (G15). '
  'Returns: { success: true, deletion_scheduled_at: "<timestamp>" }. '
  'SECURITY DEFINER — service-role client only. PRD 05.';

REVOKE ALL ON FUNCTION public.soft_delete_employee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_employee(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 6b. RPC: hard_delete_employee(p_target_profile_id uuid) RETURNS jsonb
--
-- Immediately deletes the target profiles row (irreversible).
-- Auth.users deletion is the Server Action's responsibility — call
-- auth.admin.banUser BEFORE and auth.admin.deleteUser AFTER this RPC (S-2).
-- Writes 'hard_deleted' log entry BEFORE the DELETE (log row must survive).
--
-- This RPC is NOT called by the pg_cron job — the internal function
-- _promote_scheduled_deletions (6e) handles the cron path with its own
-- minimal delete logic (B-1 reviewer requirement).
--
-- Guards:
--   G1. Caller must be company admin or platform admin.
--   G2. For non-platform admins: target must be in same company.
--   G3. Last-admin lockout (caller deleting themselves).
--   G7. Target must not be a platform admin.
--   G15. Target status must not be 'pending' (FR-19) — use cancel_invite instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hard_delete_employee(
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id           uuid;
  v_caller_company      uuid;
  v_caller_role         text;
  v_is_platform         boolean;
  v_target_company      uuid;
  v_target_status       text;
  v_target_role         text;
  v_target_is_platform  boolean;
  v_target_email        text;
  v_admin_count         bigint;
BEGIN
  -- Resolve caller identity.
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

  -- Read target state.
  SELECT p.company_id, p.status, p.role, p.is_platform_admin, u.email
  INTO   v_target_company, v_target_status, v_target_role, v_target_is_platform, v_target_email
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id = p_target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found: profile % does not exist', p_target_profile_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- G2
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G7
  IF v_target_is_platform THEN
    RAISE EXCEPTION 'platform_admin_protected: platform admin accounts cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G15: pending profiles must go through cancel_invite, not hard_delete.
  IF v_target_status = 'pending' THEN
    RAISE EXCEPTION 'cannot_delete_pending: cancel the invitation instead'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- G3: last-admin lockout when caller is deleting themselves.
  IF v_caller_id = p_target_profile_id THEN
    SELECT COUNT(*)
    INTO   v_admin_count
    FROM   public.profiles
    WHERE  company_id = v_target_company
      AND  role       = 'admin'
      AND  status    != 'deactivated'
      AND  id        != p_target_profile_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'last_admin_lockout: you must promote another admin before deleting your own account'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Write audit log BEFORE the DELETE.
  -- The profiles row still exists at this point; we capture email and company.
  -- After the DELETE, the FKs on the log row become NULL (ON DELETE SET NULL).
  -- The denormalized target_email and target_company_id survive the delete.
  INSERT INTO public.employee_lifecycle_log
    (actor_profile_id, target_profile_id, target_email, target_company_id, action)
  VALUES
    (v_caller_id, p_target_profile_id, v_target_email, v_target_company, 'hard_deleted');

  -- Delete the profiles row.
  -- FK consequences (executed by PostgreSQL FK machinery):
  --   team_members.profile_id → SET NULL (tombstone rows preserved, 20260819000001)
  --   boards.created_by       → SET NULL (board tombstones preserved, 20260819000001)
  --   employee_lifecycle_log.actor_profile_id  → SET NULL (if this profile was an actor in past log entries)
  --   employee_lifecycle_log.target_profile_id → SET NULL (including the row we just inserted above)
  --   auth.users FK (profiles_auth_users_fkey) → this is ON DELETE CASCADE from auth.users to profiles,
  --     NOT the other direction. Deleting the profiles row does NOT cascade to auth.users.
  --     The Server Action must call auth.admin.deleteUser separately (FR-18, S-2).
  DELETE FROM public.profiles
  WHERE  id = p_target_profile_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.hard_delete_employee(uuid) IS
  'Immediately deletes a profiles row (irreversible). '
  'Writes ''hard_deleted'' audit log entry BEFORE the DELETE so the log row '
  'is captured before the FK SET NULL actions fire on it. '
  'Does NOT delete the auth.users row — the Server Action must call '
  'auth.admin.banUser BEFORE and auth.admin.deleteUser AFTER this RPC (S-2 sequencing). '
  'FK consequences: team_members.profile_id → NULL (tombstone), '
  'boards.created_by → NULL (tombstone), log FKs → NULL. '
  'NOT called by the pg_cron job — _promote_scheduled_deletions has its own '
  'minimal delete path without auth.uid() guards (B-1). '
  'Guards: admin caller (G1), company scope (G2), last-admin self-delete (G3), '
  'platform admin protection (G7), not-pending (G15). '
  'SECURITY DEFINER — service-role client only. PRD 05.';

REVOKE ALL ON FUNCTION public.hard_delete_employee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hard_delete_employee(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 6c. RPC: cancel_scheduled_deletion(p_target_profile_id uuid) RETURNS jsonb
--
-- Cancels a soft-delete grace window. Clears deletion_scheduled_at = NULL.
-- Status remains 'active' — per RD-01, only active profiles could have been
-- soft-deleted, so there is no ambiguity about the restored status (N-1).
-- The Server Action must call auth.admin.updateUserById({ ban_duration: 'none' })
-- AFTER this RPC succeeds to restore the user's login access (RD-02).
-- Writes 'deletion_undone' log entry on success.
--
-- Concurrency guard (EC-07):
--   Uses a conditional UPDATE that only clears deletion_scheduled_at if it is
--   currently non-null. If deletion_scheduled_at was already NULL (meaning the
--   cron job promoted it to a hard delete, or another concurrent cancel ran
--   first), GET DIAGNOSTICS detects zero rows updated and returns
--   { "success": false, "reason": "already_deleted" }.
--   This is the optimistic-lock concurrency pattern for the cron-vs-cancel race.
--
-- Guards:
--   G1. Caller must be company admin or platform admin.
--   G2. For non-platform admins: target must be in same company.
--   G16. Target must have deletion_scheduled_at IS NOT NULL.
--        (If already NULL, returns no-op result; does not raise.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_scheduled_deletion(
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
  v_target_status   text;
  v_target_email    text;
  v_rows_updated    int;
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

  -- Read target state.
  SELECT p.company_id, p.status, u.email
  INTO   v_target_company, v_target_status, v_target_email
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id = p_target_profile_id;

  -- G16 (target not found case): if the profile is already gone, the cron job
  -- already promoted it to a hard delete. Return already_deleted.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'already_deleted'
    );
  END IF;

  -- G2
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G16: if deletion_scheduled_at is already NULL, the profile is not in a
  -- grace window. This is either a no-op (the admin refreshed and clicked
  -- cancel on a row that was already active) or the cron beat them.
  -- The conditional UPDATE handles both cases atomically: if the row has
  -- deletion_scheduled_at IS NULL, the UPDATE touches 0 rows.
  UPDATE public.profiles
  SET    deletion_scheduled_at = NULL
  WHERE  id                   = p_target_profile_id
    AND  deletion_scheduled_at IS NOT NULL;  -- optimistic lock: only clear if still in window

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Concurrency guard (EC-07): 0 rows updated means the cron job already promoted
  -- the deletion (deletion_scheduled_at was set to NULL by _promote_scheduled_deletions
  -- just before the cancel arrived). Return already_deleted — the profile is gone.
  IF v_rows_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'already_deleted'
    );
  END IF;

  -- N-1: status is always 'active' here — only active profiles can be soft-deleted
  -- (RD-01 CHECK constraint), so there is no ambiguity about the restored state.
  -- We do NOT store or retrieve a previous status; 'active' is the only legal
  -- pre-soft-delete state by design.
  -- (No UPDATE to status needed — it was never changed by soft_delete_employee.)

  -- Write audit log entry.
  INSERT INTO public.employee_lifecycle_log
    (actor_profile_id, target_profile_id, target_email, target_company_id, action)
  VALUES
    (v_caller_id, p_target_profile_id, v_target_email, v_target_company, 'deletion_undone');

  RETURN jsonb_build_object(
    'success', true,
    'noop',    false
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_scheduled_deletion(uuid) IS
  'Cancels a soft-delete grace window by clearing profiles.deletion_scheduled_at. '
  'Status remains ''active'' — the only legal pre-soft-delete status (RD-01, N-1). '
  'No previous-status lookup needed; active is the only restorable state. '
  'Does NOT unban Auth account — Server Action must call auth.admin.updateUserById '
  '{ ban_duration: ''none'' } AFTER this RPC succeeds (RD-02). '
  'Concurrency guard (EC-07): conditional UPDATE (WHERE deletion_scheduled_at IS NOT NULL) '
  'acts as an optimistic lock. If 0 rows updated, the cron job already promoted the '
  'deletion — return { success: false, reason: ''already_deleted'' }. '
  'Guards: admin caller (G1), company scope (G2), grace-window check (G16). '
  'Writes ''deletion_undone'' audit log on success. '
  'SECURITY DEFINER — service-role client only. PRD 05.';

REVOKE ALL ON FUNCTION public.cancel_scheduled_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_deletion(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 6d. RPC: cancel_invite(p_target_profile_id uuid) RETURNS jsonb (S-3)
--
-- Cancels a pending invitation by deleting the profiles row.
-- Auth.users deletion is the Server Action's responsibility — call
-- auth.admin.deleteUser AFTER this RPC succeeds (EC-08 sequencing).
-- Note: the PRD (EC-08) specifies auth.admin.deleteUser FIRST, then profiles.
-- However, since cancel_invite now wraps the profiles DELETE in an RPC,
-- the sequencing is: RPC succeeds (profiles row deleted) → Server Action calls
-- auth.admin.deleteUser. If auth deletion fails, the profile is already gone.
-- The Server Action must handle this partial-failure case (see backend handoff).
-- Writes 'invite_cancelled' log entry BEFORE the DELETE.
--
-- Guards:
--   G1. Caller must be company admin or platform admin.
--   G2. For non-platform admins: target must be in same company.
--   G17 (new, S-3): target status must be 'pending'. Raises not_pending if the
--        invitee has already accepted (race condition protection).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invite(
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
  v_target_status   text;
  v_target_email    text;
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

  -- Read target state.
  SELECT p.company_id, p.status, u.email
  INTO   v_target_company, v_target_status, v_target_email
  FROM   public.profiles p
  JOIN   auth.users u ON u.id = p.id
  WHERE  p.id = p_target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found: profile % does not exist', p_target_profile_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- G2
  IF NOT v_is_platform AND v_target_company != v_caller_company THEN
    RAISE EXCEPTION 'cross_company_denied: target profile is not in your company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- G17 (S-3): target must still be pending.
  -- Guards against the race where the invitee accepted just before the admin
  -- clicked cancel. The 'not_pending' error signals to the UI to refresh the
  -- row and let the admin decide on the now-active employee.
  IF v_target_status != 'pending' THEN
    RAISE EXCEPTION 'not_pending: only pending invitations can be cancelled (current status: %)', v_target_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Write audit log BEFORE the DELETE.
  -- Capture email and company while the profiles row still exists.
  INSERT INTO public.employee_lifecycle_log
    (actor_profile_id, target_profile_id, target_email, target_company_id, action)
  VALUES
    (v_caller_id, p_target_profile_id, v_target_email, v_target_company, 'invite_cancelled');

  -- Delete the profiles row.
  -- FK consequences:
  --   profiles_auth_users_fkey: auth.users → profiles (CASCADE direction) does
  --     NOT cascade from profiles DELETE to auth.users. The Server Action must
  --     call auth.admin.deleteUser separately after this RPC returns.
  --   employee_lifecycle_log FKs: the row we just inserted becomes
  --     target_profile_id = NULL (ON DELETE SET NULL). That is correct —
  --     the log entry preserves target_email for identification.
  DELETE FROM public.profiles
  WHERE  id = p_target_profile_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.cancel_invite(uuid) IS
  'Cancels a pending invitation by deleting the profiles row. '
  'Writes ''invite_cancelled'' audit log entry BEFORE the DELETE. '
  'Does NOT delete the auth.users row — Server Action must call '
  'auth.admin.deleteUser AFTER this RPC succeeds. If auth deletion fails, '
  'the profiles row is already gone (partial failure — see backend handoff '
  'remediation section). '
  'Guards: admin caller (G1), company scope (G2), pending-only target (G17 S-3). '
  'G17 protects the race where the invitee accepted just before the admin '
  'clicked cancel — raises not_pending so UI can refresh and re-decide. '
  'SECURITY DEFINER — service-role client only. PRD 05 FR-09, S-3.';

REVOKE ALL ON FUNCTION public.cancel_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_invite(uuid) TO service_role;


-- ---------------------------------------------------------------------------
-- 6e. RPC: _promote_scheduled_deletions() RETURNS integer (B-1, RD-05)
--
-- Internal function called exclusively by the pg_cron job every 5 minutes.
-- Iterates profiles WHERE deletion_scheduled_at IS NOT NULL AND < now()
-- and performs a minimal hard delete for each.
--
-- IMPORTANT (B-1 reviewer requirement):
--   This function does NOT call hard_delete_employee(). That RPC has an
--   auth.uid()-derived guard (G1) that returns NULL under a pg_cron context
--   (no live user session), which would fail the admin-privilege check.
--   This function implements its own minimal delete path:
--   1. Check is_platform_admin = false (skip row + continue if true).
--   2. Write 'hard_deleted' log entry capturing email and company BEFORE delete.
--   3. DELETE the profiles row.
--   No auth.uid() used anywhere in this function.
--
-- Returns: count of profiles deleted in this invocation.
--
-- Security:
--   SECURITY DEFINER — runs as postgres role (bypasses RLS, has full access).
--   Callable by service_role and postgres ONLY.
--   REVOKE from PUBLIC; GRANT to service_role only.
--   NOT granted to authenticated — no end-user invocation path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._promote_scheduled_deletions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row             record;
  v_deleted_count   int := 0;
  v_row_count       int;   -- EC-07: row count after the guarded DELETE
BEGIN
  -- Iterate over all profiles whose grace window has expired.
  -- The partial index idx_profiles_deletion_scheduled_at makes this scan efficient.
  FOR v_row IN
    SELECT p.id, p.company_id, p.is_platform_admin, u.email
    FROM   public.profiles p
    JOIN   auth.users u ON u.id = p.id
    WHERE  p.deletion_scheduled_at IS NOT NULL
      AND  p.deletion_scheduled_at < now()
  LOOP
    -- B-1 safety guard: never delete a platform admin via the cron path.
    -- This should not occur because soft_delete_employee (G7) blocks scheduling
    -- a platform admin for deletion. But if the flag was set via direct SQL or
    -- a migration error, this guard prevents catastrophic data loss.
    -- Skip the row (continue to next) — do NOT raise, because a raised exception
    -- would abort the entire loop iteration and leave other due-for-deletion
    -- profiles unprocessed.
    IF v_row.is_platform_admin THEN
      -- Log a warning via RAISE NOTICE (goes to PostgreSQL log, not to the caller).
      RAISE NOTICE '_promote_scheduled_deletions: SKIPPING platform admin % — deletion_scheduled_at should not have been set',
        v_row.id;
      CONTINUE;  -- move to the next row
    END IF;

    -- EC-07 race mitigation: DELETE only if deletion_scheduled_at is still non-null.
    -- cancel_scheduled_deletion clears this column. If the cancel RPC committed
    -- between our loop-SELECT above and this DELETE, the WHERE guard ensures we
    -- do nothing and skip the log write below (a cancelled deletion must not
    -- appear in the audit log as 'hard_deleted').
    DELETE FROM public.profiles
    WHERE  id                   = v_row.id
      AND  deletion_scheduled_at IS NOT NULL;  -- EC-07 race guard

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    -- If 0 rows deleted, cancel_scheduled_deletion won the race — do not log.
    IF v_row_count = 0 THEN
      CONTINUE;
    END IF;

    -- Write 'hard_deleted' audit log AFTER the confirmed DELETE.
    -- FK consequences have already fired: target_profile_id on the log row we
    -- are about to insert will immediately become NULL (ON DELETE SET NULL).
    -- We capture email and company from the pre-delete snapshot in v_row.
    -- actor_profile_id is NULL (no live user session in cron context).
    INSERT INTO public.employee_lifecycle_log
      (actor_profile_id, target_profile_id, target_email, target_company_id, action, metadata)
    VALUES
      (
        NULL,              -- no actor (cron-initiated deletion)
        v_row.id,
        v_row.email,
        v_row.company_id,
        'hard_deleted',
        jsonb_build_object('source', 'cron', 'promoted_at', now()::text)
      );

    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION public._promote_scheduled_deletions() IS
  'Internal pg_cron function. Runs every 5 minutes to promote expired soft-deletes '
  'to hard deletes. Iterates profiles WHERE deletion_scheduled_at IS NOT NULL AND < now(). '
  'Self-contained (reviewer B-1): does NOT call hard_delete_employee() because that RPC '
  'uses auth.uid() guards that fail in a cron context (no live session). '
  'Implements its own minimal path: check is_platform_admin (skip + NOTICE if true), '
  'DELETE profiles row with EC-07 race guard (AND deletion_scheduled_at IS NOT NULL), '
  'check GET DIAGNOSTICS ROW_COUNT — if 0, cancel_scheduled_deletion won the race so '
  'skip the log write; if 1, write hard_deleted log entry (actor_profile_id = NULL, '
  'metadata.source = ''cron''). Log write always follows confirmed DELETE. '
  'Auth.users cleanup is handled by the auth-sweep Vercel cron endpoint '
  '(see database-to-backend-employee-lifecycle.md). '
  'Returns count of profiles deleted. '
  'SECURITY DEFINER — callable by service_role and postgres only. '
  'NEVER grant EXECUTE to authenticated. PRD 05 RD-05, reviewer B-1, EC-07.';

REVOKE ALL ON FUNCTION public._promote_scheduled_deletions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._promote_scheduled_deletions() TO service_role;
-- postgres role (which owns the function and runs pg_cron jobs) can already
-- execute any function it owns without an explicit GRANT.


-- =============================================================================
-- 7. pg_cron job scheduling (RD-05)
--
-- Schedule the promote-scheduled-deletions job to run every 5 minutes.
-- cron.schedule is idempotent IF a job with the same name already exists —
-- it updates the schedule. On first run (new installation), it inserts a new job.
--
-- The cron job calls _promote_scheduled_deletions() via SELECT — this is the
-- correct invocation pattern for a function that returns a scalar.
--
-- IMPORTANT: This SELECT runs as the postgres role (the cron infrastructure's
-- default execution context in Supabase). _promote_scheduled_deletions is
-- SECURITY DEFINER and owned by postgres, so execution proceeds correctly.
--
-- Auth.users cleanup companion:
--   _promote_scheduled_deletions deletes the profiles row but CANNOT call the
--   Supabase Auth admin HTTP API from inside PostgreSQL. Orphaned auth.users
--   rows (no corresponding profiles row) are cleaned up by the auth-sweep
--   Vercel cron endpoint. See backend handoff for the full auth-sweep spec.
-- =============================================================================
SELECT cron.schedule(
  'promote-scheduled-deletions',
  '*/5 * * * *',
  $$SELECT public._promote_scheduled_deletions();$$
);


-- =============================================================================
-- Smoke test reminder (document results in handoff):
--
-- After running this migration, verify:
--
-- 1. Service-role grants inherited for employee_lifecycle_log:
--    BEGIN;
--    SET LOCAL ROLE service_role;
--    INSERT INTO public.employee_lifecycle_log
--      (target_email, target_company_id, action)
--    VALUES ('smoke@test.invalid', '00000000-0000-0000-0000-000000000001', 'invite_sent');
--    ROLLBACK;
--    -- Expected: INSERT 0 1 (then ROLLBACK undoes it)
--
-- 2. Cron job registered:
--    SELECT jobname, schedule, command FROM cron.job
--    WHERE jobname = 'promote-scheduled-deletions';
--    -- Expected: 1 row, schedule '*/5 * * * *'
--
-- 3. pg_cron extension installed:
--    SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
--    -- Expected: 1 row
-- =============================================================================


-- =============================================================================
-- End of migration 20260819000002_employee_lifecycle_deletion.sql
-- =============================================================================
