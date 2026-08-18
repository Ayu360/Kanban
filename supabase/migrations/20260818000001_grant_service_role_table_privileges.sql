-- =============================================================================
-- Migration: 20260818000001_grant_service_role_table_privileges.sql
--
-- Purpose:
--   Grant the service_role database role explicit table-level DML privileges
--   on all existing tables in schema public, and set default privileges so that
--   any future table created in public inherits those grants automatically.
--
-- Root cause:
--   PostgreSQL 42501 ("permission denied for table team_members") was raised
--   when the addMember Server Action used the service-role supabase client to
--   INSERT directly into public.team_members. The diagnostic error from the
--   Next.js server terminal confirmed this exactly:
--
--     code: '42501'
--     message: 'permission denied for table team_members'
--     hint: 'Grant the required privileges to the current role with:
--            GRANT SELECT, INSERT ON public.team_members TO service_role;'
--
--   Supabase's default bootstrap GRANTs (which cover service_role on every
--   public table) are absent in this project. All prior migrations granted
--   only to the `authenticated` role. SECURITY DEFINER functions (e.g.
--   create_team_with_board) masked this gap because they execute as the
--   function owner — a superuser — and never needed table-level grants. The
--   moment the addMember path dropped the SECURITY DEFINER wrapper and
--   inserted directly via the service-role client, the missing grant surfaced.
--
-- Fix:
--   1. GRANT ALL PRIVILEGES on every current table in public to service_role.
--   2. GRANT ALL PRIVILEGES on every current sequence in public to service_role
--      (no sequences today — UUID PKs throughout — but future serial columns
--      would silently break on INSERT without this; included for durability).
--   3. ALTER DEFAULT PRIVILEGES so every object subsequently created in public
--      by the postgres role automatically carries these grants.
--
-- On GRANT ALL vs. enumerated GRANT:
--   GRANT ALL on tables also covers TRUNCATE, REFERENCES, and TRIGGER beyond
--   the standard DML set (SELECT, INSERT, UPDATE, DELETE). For the service_role
--   this is correct: the service-role key is the unrestricted server-side key
--   intended to bypass RLS and have full write authority. Limiting it to
--   enumerated DML only creates a maintenance trap — any future operation
--   (e.g., a migration that TRUNCATEs a table via service_role) would fail
--   silently with a new 42501 until another grant migration is written.
--   GRANT ALL documents the intent ("service_role is unrestricted on tables")
--   and prevents the same class of bug from recurring.
--
-- Scope:
--   - Grants to service_role ONLY. authenticated and anon grants are untouched.
--   - No RLS changes. No schema changes. No function grants.
--   - Function grants for service_role are already explicit in the migrations
--     that created those functions (change_employee_role, deactivate_employee,
--     reactivate_employee, create_team_with_board). Those are not repeated here.
--   - This migration does not touch auth schema objects. auth.users and
--     auth.* are managed by Supabase internally.
--
-- On ALTER DEFAULT PRIVILEGES scope:
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public FOR ROLE postgres affects objects
--   created by the postgres role going forward. Supabase migrations run as
--   postgres by default, so all future CREATE TABLE statements in migrations
--   will automatically grant service_role the same privileges declared here.
--   This covers the current gap completely for a Supabase-managed project.
--
-- Rollback (dev/staging only — NEVER on production with live data):
-- -----------------------------------------------------------------------------
--   REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM service_role;
--   REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM service_role;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public FOR ROLE postgres
--     REVOKE ALL ON TABLES FROM service_role;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public FOR ROLE postgres
--     REVOKE ALL ON SEQUENCES FROM service_role;
-- -----------------------------------------------------------------------------
-- WARNING: rolling back on production will immediately break every Server Action
-- that uses the service-role client for direct table writes (addMember,
-- removeMember, deleteTeam, employee role changes, deactivation, reactivation,
-- and invite bootstrap). Only roll back if you are replacing service-role direct
-- writes with SECURITY DEFINER RPCs for all of those callers in the same deploy.
-- =============================================================================


-- =============================================================================
-- 1. Grant service_role full privileges on all current tables in public
--
-- Covers every table created by migrations up to and including this one:
--   public.companies     (20260802000001)
--   public.profiles      (20260802000001)
--   public.teams         (20260809000001)
--   public.team_members  (20260809000001)
--   public.boards        (20260809000001)
--   public.columns       (20260809000001)
--
-- Views (employee_directory, admin_employee_list) are intentionally excluded
-- from this blanket grant. Views have their own explicit grants defined in
-- 20260816000002_employees_schema.sql and those are already correct:
--   employee_directory  → authenticated only
--   admin_employee_list → service_role only (already granted)
-- Using ALL TABLES IN SCHEMA would also cover views, which is harmless but
-- unnecessary noise. The base-table grant here is what unblocks the bug.
-- We use ALL TABLES IN SCHEMA for forward-compatibility: new tables added by
-- future migrations (e.g., tasks) will be covered by the default privileges
-- in section 3, but tables that already exist when this migration runs are
-- covered by this statement.
--
-- GRANT is idempotent by PostgreSQL specification: re-running a GRANT for
-- privileges that are already held is a no-op, not an error. This migration
-- is safe to run multiple times.
-- =============================================================================

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;


-- =============================================================================
-- 2. Grant service_role full privileges on all current sequences in public
--
-- No sequences are in use today: all primary keys are uuid generated by
-- gen_random_uuid() which does not consume a sequence. This grant is included
-- because:
--   a) A future migration may add a serial/bigserial column (e.g., a sort_order
--      or surrogate key). Without USAGE + SELECT on the sequence, an INSERT from
--      a service-role client would fail with a 42501 on the sequence, not the
--      table, and the diagnostic message would be confusing.
--   b) Some Supabase internal bookkeeping tables in public may use sequences
--      depending on version.
--
-- ALL SEQUENCES IN SCHEMA is idempotent for the same reason as TABLES above.
-- =============================================================================

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;


-- =============================================================================
-- 3. Set default privileges for future objects created by the postgres role
--
-- This is the durability fix that prevents the same class of bug from recurring
-- when new tables or sequences are added by future migrations.
--
-- Supabase runs all migration files as the postgres role. Therefore:
--   - Every CREATE TABLE executed by a future migration is owned by postgres.
--   - This ALTER DEFAULT PRIVILEGES statement instructs PostgreSQL to
--     automatically GRANT ALL on that new table/sequence to service_role
--     at creation time, before any row is inserted.
--
-- Without this, every future migration that adds a new table (e.g., tasks)
-- and uses the service-role client to write to it would hit the same 42501
-- until yet another grant migration was written.
--
-- FOR ROLE postgres: scope this to objects created by postgres specifically.
-- IN SCHEMA public: scope to the public schema only (not auth, storage, etc.).
-- =============================================================================

ALTER DEFAULT PRIVILEGES
  FOR ROLE postgres
  IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES
  FOR ROLE postgres
  IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;


-- =============================================================================
-- End of migration 20260818000001_grant_service_role_table_privileges.sql
-- =============================================================================
