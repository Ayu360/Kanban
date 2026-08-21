-- =============================================================================
-- Migration: 20260820000001_admin_employee_list_add_deletion_scheduled.sql
-- Purpose:   Adds deletion_scheduled_at to the admin_employee_list view so
--            the backend and frontend can surface the "Deletion Scheduled"
--            status badge and scheduled deletion timestamp.
--
-- Depends on:
--   20260816000002_employees_schema.sql  — original admin_employee_list view
--   20260819000002_employee_lifecycle_deletion.sql — profiles.deletion_scheduled_at
--
-- What this migration changes:
--   CREATE OR REPLACE VIEW admin_employee_list — adds deletion_scheduled_at
--   to the SELECT projection. All other columns and grants are preserved.
--
-- Gap (a) from senior-code-reviewer: the existing view does not include
-- deletion_scheduled_at. The frontend cannot display the "Deletion Scheduled"
-- badge or the scheduled timestamp without this column on the DTO. The
-- backend SupabaseEmployeesRepository.listByCompany / getById queries must
-- also select this column so the AdminEmployee DTO carries it.
--
-- Rollback:
--   DROP VIEW IF EXISTS public.admin_employee_list;
--   Then recreate without deletion_scheduled_at (revert to 20260816000002 version).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- UPDATE VIEW: public.admin_employee_list
--
-- Adds deletion_scheduled_at to the projection.
-- All other columns, WHERE clause (none — unscoped; Server Action applies
-- company_id filter), and security_invoker setting are preserved from
-- 20260816000002.
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
    p.deletion_scheduled_at,
    p.is_platform_admin,
    p.created_at,
    u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id;

COMMENT ON VIEW public.admin_employee_list IS
  'Full projection of profiles + auth.users.email for admin employee management. '
  'Includes status, deactivated_at, deletion_scheduled_at, is_platform_admin. '
  'Granted to service_role ONLY — not accessible via authenticated or anon key. '
  'Admin Server Actions query this via the service-role client. '
  'deletion_scheduled_at added in 20260820000001 (gap a) so the frontend can '
  'display the "Deletion Scheduled" status badge and scheduled timestamp. '
  'Not company-scoped in the view itself — the Server Action must apply '
  'company_id filter in the query WHERE clause.';

REVOKE ALL ON public.admin_employee_list FROM PUBLIC;
GRANT SELECT ON public.admin_employee_list TO service_role;


-- =============================================================================
-- End of migration 20260820000001_admin_employee_list_add_deletion_scheduled.sql
-- =============================================================================
