-- =============================================================================
-- Migration: 20260802000001_auth_schema.sql
-- Purpose:   Authentication database layer — companies, profiles, enums,
--            constraints, indexes, RLS, and the default-company seed row.
--
-- Rollback considerations:
--   Dropping these tables is destructive. The safe rollback is:
--     DROP TABLE IF EXISTS public.profiles CASCADE;
--     DROP TABLE IF EXISTS public.companies CASCADE;
--     DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
--   Only run rollback on a dev/staging environment. Never on production.
--
-- Tenancy note (ADR-0006):
--   Both tables carry company_id from day one. The seed row for the default
--   company is inserted here so that the signup Server Action can always find
--   a valid company_id without additional setup steps.
--
-- JWT sync:
--   A separate migration (20260802000002_jwt_sync_hook.sql) installs the
--   Supabase custom_access_token hook that propagates company_id and
--   is_platform_admin into app_metadata. This migration has no dependency
--   on that order — the hook simply reads from profiles when it fires.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions (guard — these are present on all Supabase projects by default)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() on PG < 13
-- Note: on PG 13+ gen_random_uuid() is built-in; pgcrypto is a no-op guard.

-- ---------------------------------------------------------------------------
-- 1. updated_at trigger function
--    Reusable across all tables. Created once here; never recreated if it
--    already exists (CREATE OR REPLACE is safe).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''  -- prevent search_path injection; only uses built-ins (now())
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_updated_at() IS
  'Automatically sets updated_at to now() on every UPDATE. Attach to any table that carries an updated_at column.';

-- ---------------------------------------------------------------------------
-- 2. companies table
--
-- Design decisions:
--   - UUID primary key (gen_random_uuid) per project convention.
--   - `name` uses text (not varchar(n)) per project principle — no arbitrary
--     length cap without a real business constraint.
--   - `is_active` boolean for soft-disable of a tenant without hard deletes.
--     Multi-tenancy expansion will need to deactivate companies without
--     losing historical data.
--   - No `company_id` self-reference here — companies is the root of the
--     tenancy tree.
--   - Timestamps: timestamptz, not null, server-defaulted.
--
-- Multi-tenancy readiness:
--   This table IS the tenant. Future migrations add billing, slug, plan etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT companies_pkey PRIMARY KEY (id),
  CONSTRAINT companies_name_check CHECK (char_length(trim(name)) > 0)
);

COMMENT ON TABLE  public.companies              IS 'Tenant root. One row per company. MVP has exactly one seeded row.';
COMMENT ON COLUMN public.companies.id           IS 'Tenant identifier. Referenced as company_id on every business table (ADR-0006).';
COMMENT ON COLUMN public.companies.name         IS 'Human-readable company name. Must be non-empty after trimming whitespace.';
COMMENT ON COLUMN public.companies.is_active    IS 'Soft-disable flag. Inactive companies cannot have users log in (enforced via RLS in the future).';

-- updated_at trigger for companies
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed — Default Company (MVP single-tenant seed)
--
-- The UUID is fixed so that other migrations and documentation can reference
-- it without a query. Named clearly so no one mistakes it for real data.
-- The ON CONFLICT guard makes this migration idempotent.
--
-- ADR-0006: "A single row is inserted into companies for the MVP."
-- ---------------------------------------------------------------------------
INSERT INTO public.companies (id, name, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Company',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. profiles table
--
-- Design decisions:
--   id:               Same UUID as auth.users.id — 1:1 extension pattern.
--                     NOT generated here; populated by the signup Server Action
--                     or a future on-insert trigger if that becomes cleaner.
--
--   company_id:       NOT NULL FK to companies per ADR-0006. Every user belongs
--                     to exactly one company (for MVP; post-MVP may be 1:many).
--
--   role:             text with CHECK constraint (not a Postgres enum).
--                     Reason: adding a new role value to a CHECK is a simple
--                     ALTER TABLE + migration; adding an enum value requires
--                     ALTER TYPE which is schema-lock-heavy and more disruptive.
--                     ADR-0007 specifies 'admin' | 'employee'.
--
--   is_platform_admin: boolean NOT NULL DEFAULT false.
--                     Orthogonal to role (ADR-0008). Grants cross-tenant
--                     visibility to RLS policies.
--
--   display_name:     Nullable text. Optional per PRD Database Requirements.
--                     Future migration can add NOT NULL after a backfill.
--
--   avatar_url:       Nullable text. Not in PRD but pre-placed for the
--                     common avatar pattern; costs nothing now, avoids a
--                     future ALTER TABLE.
--                     -- REMOVED: PRD does not mention it; strict scope.
--                     (Keeping scope tight to what the PRD specifies.)
--
--   ON DELETE CASCADE for auth.users FK: if Supabase Auth hard-deletes a
--   user (e.g. via admin console), the profile row is removed automatically.
--   This prevents orphaned profiles that could never be authenticated against.
--
--   ON DELETE RESTRICT for companies FK: a company cannot be deleted while
--   profiles reference it. Forces explicit user re-homing before company
--   removal. Safest default for a tenant-root table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                uuid        NOT NULL,
  company_id        uuid        NOT NULL,
  role              text        NOT NULL DEFAULT 'employee',
  is_platform_admin boolean     NOT NULL DEFAULT false,
  display_name      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profiles_pkey
    PRIMARY KEY (id),

  CONSTRAINT profiles_auth_users_fkey
    FOREIGN KEY (id)
    REFERENCES auth.users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT profiles_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'employee')),

  CONSTRAINT profiles_display_name_check
    CHECK (display_name IS NULL OR char_length(trim(display_name)) > 0)
);

COMMENT ON TABLE  public.profiles                    IS 'Application identity layer extending auth.users. Holds role, tenancy, and admin flags.';
COMMENT ON COLUMN public.profiles.id                 IS 'Same UUID as auth.users.id. Primary key of this 1:1 extension table.';
COMMENT ON COLUMN public.profiles.company_id         IS 'Tenant scope. Non-nullable per ADR-0006. MVP: always the Default Company UUID.';
COMMENT ON COLUMN public.profiles.role               IS 'Company-scoped role: admin (manages team/users within company) or employee. ADR-0007.';
COMMENT ON COLUMN public.profiles.is_platform_admin  IS 'Platform superuser flag. When true, RLS policies bypass company_id scoping. ADR-0008.';
COMMENT ON COLUMN public.profiles.display_name       IS 'Optional display name. If null, consumers fall back to auth.users.email.';

-- updated_at trigger for profiles
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Indexes
--
-- Query pattern analysis:
--
--   P1. RLS policies on profiles check company_id on almost every SELECT,
--       and company admin reads filter on both company_id + role.
--       A composite B-tree on (company_id, role) covers P1 via leading-column
--       prefix scan — no separate single-column idx_profiles_company_id needed.
--       -> idx_profiles_company_id_role
--
--   P2. RLS policies read is_platform_admin as a short-circuit. On most
--       requests this resolves to false — but the predicate still executes.
--       A partial index on the true case is tiny (few rows) and very fast
--       when evaluating the platform-admin bypass path.
--       -> idx_profiles_platform_admin_true
--
--   P3. The default company UUID is a constant looked up on every signup.
--       Single-row PK lookup — no index needed; covered by companies_pkey.
-- ---------------------------------------------------------------------------

-- Supports company admin reads: "give me all employees in my company" (P1 + P2 combined).
-- Leading-column prefix also covers any query filtering on company_id alone,
-- so no separate single-column idx_profiles_company_id is needed.
CREATE INDEX IF NOT EXISTS idx_profiles_company_id_role
  ON public.profiles (company_id, role);

-- Tiny partial index: only platform-admin rows. Used to short-circuit
-- the is_platform_admin bypass branch in RLS policies. Near-zero storage cost.
CREATE INDEX IF NOT EXISTS idx_profiles_platform_admin_true
  ON public.profiles (id)
  WHERE is_platform_admin = true;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security — companies
--
-- Policy model (ADR-0003, ADR-0008):
--   SELECT: authenticated users may read their own company row (JWT company_id
--           match). Platform admins may read all company rows.
--           Two SELECT policies OR together (Postgres permissive policy union).
--           For MVP this resolves to the single Default Company row for every
--           user, but the predicate is correct for post-MVP multi-tenant use
--           without a breaking migration change.
--   INSERT/UPDATE/DELETE: service-role only (no policy = deny for anon/auth).
--     The service-role key bypasses RLS entirely — no explicit policy needed.
--     We rely on ENABLE ROW LEVEL SECURITY + no permissive policy for writes,
--     which means the only path to write companies is via service-role.
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users can read the company their JWT is scoped to.
-- Predicate matches the company_id embedded in app_metadata by the
-- custom_access_token hook. For MVP (one company) this is always satisfied;
-- for post-MVP multi-tenancy it correctly restricts cross-tenant reads.
CREATE POLICY companies_select_own_company
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
  );

-- SELECT: platform admins can read all company rows (support / admin console).
-- JWT-staleness note: is_platform_admin changes take effect only after the
-- user's JWT is refreshed (default 1-hour Supabase TTL). If immediate
-- revocation of platform-admin visibility is required, call
-- supabase.auth.admin.signOut(userId) from the Server Action that performs
-- the demotion.
CREATE POLICY companies_select_platform_admin
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- No INSERT/UPDATE/DELETE policies for authenticated or anon roles.
-- Only the service-role key (which bypasses RLS) may write to companies.
-- This is enforced by the absence of a permissive write policy.

-- ---------------------------------------------------------------------------
-- 7. Row Level Security — profiles
--
-- Policy model (ADR-0003, ADR-0007, ADR-0008):
--
--   The JWT is expected to carry:
--     auth.jwt() -> 'app_metadata' ->> 'company_id'       (uuid as text)
--     auth.jwt() -> 'app_metadata' ->> 'is_platform_admin' (boolean as text)
--   These are populated by the custom_access_token hook in the companion
--   migration (20260802000002_jwt_sync_hook.sql).
--
--   Helper inline expressions used across policies:
--
--     Platform admin check:
--       (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
--
--     Own company check:
--       company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
--
--     Own row check:
--       id = auth.uid()
--
--   SELECT: own row OR (company admin of same company) OR platform admin.
--   INSERT: only via service-role (signup Server Action uses service-role to
--           insert the first profile row; subsequent ones too, because the
--           first-user-wins check must be atomic and uses SECURITY DEFINER).
--           Rationale: if we allowed authenticated INSERT, a malicious user
--           could insert a profile for another auth.users id they do not own.
--           The Server Action + service-role is the sole creation path.
--   UPDATE: own non-sensitive fields (display_name) OR service-role for
--           role/is_platform_admin changes (ADR-0015, ADR-0008).
--   DELETE: service-role only. Hard deletes are rare; cascade from auth.users
--           deletion is handled by the FK ON DELETE CASCADE.
--
-- Note on INSERT policy: We provide a restrictive INSERT policy for the
-- authenticated role that only allows a user to insert their own row.
-- However, since the first-user-wins bootstrap uses a SECURITY DEFINER
-- function called from a service-role context, that function bypasses RLS
-- entirely. The authenticated INSERT policy exists as a defense-in-depth
-- fallback for any direct anon-key insert attempt (which the Server Action
-- should never do, but belt-and-suspenders).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: users can read their own row.
-- Used by: useCurrentUser() hook reading the current session's profile.
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- SELECT: company admins can read all profiles in their own company.
-- Used by: employee management features, invite flows.
-- JWT-staleness note: role changes take effect only after the user's JWT is
-- refreshed (default 1-hour Supabase TTL). If immediate revocation of admin
-- access is required, call supabase.auth.admin.signOut(userId) from the
-- Server Action that performs the demotion.
CREATE POLICY profiles_select_company_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- SELECT: platform admins can read all profiles across all companies.
-- Used by: platform admin console (post-MVP) and support tooling.
CREATE POLICY profiles_select_platform_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- INSERT: authenticated users may only insert a profile row for their own uid.
-- This is a defense-in-depth policy. The real insertion path is the
-- SECURITY DEFINER function called via service-role, which bypasses RLS.
-- This prevents a direct anon-key insert of someone else's profile.
CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE: users can update their own display_name only.
-- Column-level control is enforced at the GRANT layer (see grants section below):
-- the authenticated role holds GRANT UPDATE (display_name) only — not a
-- table-level UPDATE grant. Role and is_platform_admin mutations are physically
-- impossible from the anon-key path regardless of RLS policy wording (ADR-0003,
-- ADR-0015). Service-role (which bypasses grants) is the only path to change
-- those columns.
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- UPDATE: platform admins can update any profile row.
--
-- IMPORTANT — what this policy actually enables from an authenticated session:
--   The column-level GRANT restricts the authenticated role to
--   UPDATE (display_name) only (see grants section). That grant is checked by
--   Postgres BEFORE RLS. So even though this policy grants row-level access to
--   every profile for a platform admin, the only column an anon-key-authenticated
--   platform admin can actually write is display_name (e.g. correcting another
--   user's display name from a support tool).
--
--   Role promotions and is_platform_admin toggles CANNOT be performed from an
--   authenticated session under any circumstance — they must go through a
--   service-role Server Action (ADR-0008, ADR-0015). The service-role client
--   bypasses both RLS and column-level grants, so this policy is not the
--   mechanism through which those privileged writes happen.
CREATE POLICY profiles_update_platform_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- DELETE: no authenticated role may delete profiles directly.
-- Deletion happens via auth.users cascade (Supabase Auth admin API) or
-- via service-role. The absence of a DELETE policy denies all direct deletes.

-- ---------------------------------------------------------------------------
-- 8. Grants
--
-- The anon and authenticated roles must be able to SELECT/INSERT/UPDATE on
-- these tables through the RLS policies above. Without explicit GRANT, the
-- roles cannot even attempt the operation (permissions are checked before RLS).
--
-- Note: config.toml has auto_expose_new_tables commented out (not true),
-- so we must grant explicitly. If auto_expose_new_tables were true this
-- would be automatic, but we prefer explicit grants for auditability.
--
-- Security note on profiles UPDATE (C2, ADR-0003):
--   A table-level UPDATE grant would allow the authenticated role to attempt
--   updates on any column, relying solely on the Server Action to restrict
--   which columns are sent — an app-layer control that can be bypassed.
--   Instead we grant column-level UPDATE on display_name only. This makes
--   role and is_platform_admin mutations physically impossible from any
--   anon-key client, regardless of what the application sends.
--   The service-role key (used by Server Actions performing role promotion)
--   bypasses column-level grants entirely, so profiles_update_platform_admin
--   policy continues to work correctly for that path.
-- ---------------------------------------------------------------------------

-- companies: authenticated users need SELECT only.
GRANT SELECT ON public.companies TO authenticated;

-- profiles: authenticated users may SELECT all columns, INSERT their own row
-- (defense-in-depth belt alongside profiles_insert_own RLS policy), and UPDATE
-- only the display_name column. role and is_platform_admin are non-writable
-- from the anon-key path at the database grant layer.
GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;

-- anon role gets no access to either table.
-- (No GRANT to anon — denies all access before RLS even evaluates.)

-- =============================================================================
-- End of migration 20260802000001_auth_schema.sql
-- =============================================================================
