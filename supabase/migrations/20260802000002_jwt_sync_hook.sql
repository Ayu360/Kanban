-- =============================================================================
-- Migration: 20260802000002_jwt_sync_hook.sql
-- Purpose:   JWT synchronization — custom_access_token hook function that
--            copies company_id, is_platform_admin, and role from profiles
--            into JWT app_metadata on every token issue and refresh.
--
-- Why needed (ADR-0007, PRD Database Requirements):
--   RLS policies read (auth.jwt() -> 'app_metadata') rather than querying
--   profiles on each row evaluation. Without this hook the JWT contains
--   only the default Supabase claims and RLS policies that reference
--   company_id or is_platform_admin would always evaluate to false/null.
--
-- Mechanism:
--   Supabase supports a custom_access_token hook: a Postgres function in
--   the public (or a designated) schema that fires before the JWT is signed.
--   The function receives the user's uid and the current token claims object,
--   and returns a modified claims object. Supabase then signs and issues
--   the modified token.
--
-- Activation:
--   The hook must be ENABLED in the Supabase Dashboard:
--     Authentication -> Hooks -> custom_access_token
--     URI: pg-functions://postgres/public/custom_access_token_hook
--   This cannot be done via a SQL migration file; see Manual Steps in the
--   architecture handoff document.
--
-- Rollback (execute in this order):
--   1. Disable the hook in the Supabase Dashboard FIRST (Authentication ->
--      Hooks -> custom_access_token). This must happen before dropping the
--      function to avoid a window where Supabase Auth tries to call a
--      non-existent function and rejects all token issuance.
--   2. DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb) CASCADE;
--   3. DROP FUNCTION IF EXISTS public.create_profile_for_user(uuid, uuid, text);
--
-- Also in this migration:
--   The first-user-wins bootstrap function — a SECURITY DEFINER Postgres
--   function that atomically checks if profiles is empty and inserts with
--   the correct role. Called via RPC from the signup Server Action.
--   This is database layer work (the atomicity guarantee lives here).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. custom_access_token hook
--
-- Input:  event jsonb — Supabase passes { "user_id": "<uuid>", "claims": {...} }
-- Output: jsonb       — the modified claims object (merged into the JWT)
--
-- What it injects into app_metadata:
--   company_id        text  (UUID as text — JWT claims are strings)
--   is_platform_admin text  ('true' / 'false' — cast to boolean in RLS)
--   role              text  ('admin' / 'employee')
--
-- Fallback behavior:
--   If no profiles row exists for the user (e.g. the hook fires before the
--   Server Action has inserted the profile row), the function returns the
--   original claims unchanged. This avoids an error during the brief window
--   between auth.users insert and profiles insert.
--
-- SECURITY DEFINER:
--   The hook function runs as the postgres superuser so it can read profiles
--   regardless of RLS. This is required — the hook fires before a session
--   is established, so auth.uid() is not yet meaningful in this context.
--   The function is tightly scoped: it only reads one profiles row and
--   returns claims. No writes, no side effects.
--
-- Grant:
--   Supabase's auth schema needs EXECUTE permission on this function.
--   The grant to supabase_auth_admin is the standard pattern for hooks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- prevent search_path injection attacks; all refs are schema-qualified
AS $$
DECLARE
  v_user_id       uuid;
  v_company_id    uuid;
  v_is_platform   boolean;
  v_role          text;
  v_claims        jsonb;
  v_app_metadata  jsonb;
BEGIN
  -- Extract the user id from the hook event payload.
  v_user_id := (event ->> 'user_id')::uuid;

  -- Retrieve the profile row for this user.
  -- If no row exists yet (race window during signup), we fall through
  -- to returning the original claims unmodified.
  SELECT
    company_id,
    is_platform_admin,
    role
  INTO
    v_company_id,
    v_is_platform,
    v_role
  FROM public.profiles
  WHERE id = v_user_id;

  -- If no profile found, return original claims (safe fallback).
  IF NOT FOUND THEN
    RETURN event;
  END IF;

  -- Extract existing claims from the event.
  v_claims       := event -> 'claims';
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);

  -- Merge our custom fields into app_metadata.
  -- Storing as text strings because JWT values are text; consumers cast them.
  v_app_metadata := v_app_metadata || jsonb_build_object(
    'company_id',        v_company_id::text,
    'is_platform_admin', v_is_platform::text,
    'role',              v_role
  );

  -- Replace app_metadata in the claims object.
  v_claims := v_claims || jsonb_build_object('app_metadata', v_app_metadata);

  -- Return the full event with updated claims.
  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase custom_access_token hook. Injects company_id, is_platform_admin, and role from profiles into JWT app_metadata so RLS policies can read them without extra queries. Must be registered in the Supabase Dashboard under Authentication -> Hooks.';

-- Grant EXECUTE to the Supabase auth internals so the hook can fire.
-- supabase_auth_admin is the role Supabase uses when invoking hooks.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

-- Revoke from public to prevent any other role from calling this directly.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. First-user-wins bootstrap function
--
-- Purpose:
--   Provides the atomic check-and-insert that the signup Server Action calls
--   via supabase.rpc('create_profile_for_user', {...}).
--   This function runs as SECURITY DEFINER (postgres role) so it can:
--     a) Read COUNT(*) from profiles without RLS interference.
--     b) Insert into profiles without needing an INSERT policy.
--   The Server Action passes the new user's id and the default company id.
--
-- Atomicity guarantee (ADR-0014):
--   The function acquires a transaction-scoped advisory lock keyed to a stable
--   integer constant representing the "profiles bootstrap" critical section.
--   7625871 is derived from hashtext('profiles_bootstrap_lock') and is stable
--   across environments (pure arithmetic, not OID-dependent).
--   pg_advisory_xact_lock is used (not pg_advisory_lock) because transaction-
--   scoped locks are safe under PgBouncer transaction pooling — the lock is
--   released automatically when the transaction ends, so no explicit unlock
--   call is needed and the lock cannot be orphaned by a connection being
--   returned to the pool mid-session.
--   This serializes concurrent first-signup calls. After the first user is
--   inserted, subsequent calls find profiles non-empty immediately — the lock
--   is only contentious in the "empty database" state, which is one-time.
--
-- Parameters:
--   p_user_id      uuid  — auth.users.id of the newly signed-up user.
--   p_company_id   uuid  — the company to assign the user to.
--                          For MVP, always the Default Company UUID.
--   p_display_name text  — optional display name from the signup form.
--
-- Returns:
--   jsonb {
--     "role":              "admin"|"employee",
--     "is_platform_admin": true|false,
--     "already_existed":   true|false   -- true if THIS user's profile row
--                                          already existed before this call
--   }
--   The Server Action reads this for logging and immediate redirect decisions.
--   already_existed = true means the INSERT did nothing (idempotent retry).
--
-- Security:
--   SECURITY DEFINER runs as the function owner (postgres/supabase_admin).
--   search_path is set to '' (empty) — the maximally-defensive form — to
--   prevent schema hijacking. All object references are fully schema-qualified.
--   MUST be called via the service-role client only. The authenticated role
--   has no EXECUTE grant on this function. This is enforced at the DB grant
--   layer: the anon-key path cannot invoke this function regardless of what
--   the application sends.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_profile_for_user(
  p_user_id      uuid,
  p_company_id   uuid,
  p_display_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- prevent search_path injection; all refs are schema-qualified
AS $$
DECLARE
  v_profile_count  bigint;
  v_is_first_user  boolean;
  v_role           text;
  v_is_platform    boolean;
  v_rows_affected  integer;
  v_actual_role    text;
  v_actual_platform boolean;
BEGIN
  -- Acquire a transaction-scoped advisory lock.
  -- Released automatically at transaction end — safe under PgBouncer
  -- transaction pooling. No explicit unlock needed or wanted.
  PERFORM pg_advisory_xact_lock(7625871::bigint);

  -- Count existing profiles while holding the lock.
  SELECT COUNT(*) INTO v_profile_count FROM public.profiles;

  v_is_first_user := (v_profile_count = 0);

  IF v_is_first_user THEN
    -- First user: platform admin + company admin.
    v_role        := 'admin';
    v_is_platform := true;
  ELSE
    -- All subsequent users: plain employee.
    v_role        := 'employee';
    v_is_platform := false;
  END IF;

  -- Insert the profile row.
  -- ON CONFLICT DO NOTHING makes this idempotent: if the Server Action
  -- retries due to a transient error, a second call does not blow up.
  INSERT INTO public.profiles (
    id,
    company_id,
    role,
    is_platform_admin,
    display_name
  )
  VALUES (
    p_user_id,
    p_company_id,
    v_role,
    v_is_platform,
    p_display_name
  )
  ON CONFLICT (id) DO NOTHING;

  -- Capture whether the INSERT actually wrote a row.
  -- ROW_COUNT = 0 means ON CONFLICT fired — the row already existed.
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Re-SELECT the authoritative values from the stored row.
  -- This ensures the return value reflects the actual persisted state,
  -- not the pre-computed v_role/v_is_platform (which may differ from what
  -- was stored on a prior insert if a concurrent caller beat us).
  SELECT role, is_platform_admin
  INTO   v_actual_role, v_actual_platform
  FROM   public.profiles
  WHERE  id = p_user_id;

  RETURN jsonb_build_object(
    'role',              v_actual_role,
    'is_platform_admin', v_actual_platform,
    'already_existed',   (v_rows_affected = 0)
  );
END;
$$;

COMMENT ON FUNCTION public.create_profile_for_user(uuid, uuid, text) IS
  'Atomic first-user-wins bootstrap. Acquires a transaction-scoped advisory lock, checks if profiles is empty, inserts the profile with appropriate role and is_platform_admin, and returns the actual persisted values plus whether the row already existed. MUST be called via the service-role client only — the authenticated role has no EXECUTE grant. ADR-0014.';

-- Grant EXECUTE to service_role only.
-- The signup Server Action MUST use the service-role client to call this
-- function. The anon-key (authenticated role) path cannot invoke it.
-- This is enforced here at the DB grant layer, not just in the application.
GRANT EXECUTE ON FUNCTION public.create_profile_for_user(uuid, uuid, text)
  TO service_role;

-- Revoke from PUBLIC for defense-in-depth (matches pattern on custom_access_token_hook).
REVOKE EXECUTE ON FUNCTION public.create_profile_for_user(uuid, uuid, text)
  FROM PUBLIC;

-- =============================================================================
-- End of migration 20260802000002_jwt_sync_hook.sql
-- =============================================================================
