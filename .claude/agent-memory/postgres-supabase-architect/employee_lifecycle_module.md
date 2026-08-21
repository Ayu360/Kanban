---
name: Employee Lifecycle Module DB Layer
description: Phase 1 lifecycle deletion — what tables/columns were added, RPCs, cron job, and structural FK change on team_members
type: project
---

Two migrations deployed as Phase 1 of PRD 05 (Employee Lifecycle & Deletion):

**20260819000001_team_members_surrogate_pk.sql**
- `team_members.id UUID NOT NULL DEFAULT gen_random_uuid()` — new surrogate PK (replaces composite PK).
- `(team_id, profile_id)` demoted to `UNIQUE NULLS NOT DISTINCT` constraint.
- `team_members.profile_id` now nullable (was NOT NULL via composite PK).
- FK `team_members_profile_id_fkey` changed from `ON DELETE CASCADE` to `ON DELETE SET NULL`.
- `check_team_member_company_match()` trigger updated: `IF NEW.profile_id IS NULL THEN RETURN NEW; END IF;` short-circuit at top.
- `boards.created_by UUID NULL` added with FK to profiles ON DELETE SET NULL (reviewer B-2 — boards table exists, column was absent).
- Partial index `idx_boards_created_by WHERE created_by IS NOT NULL`.

**20260819000002_employee_lifecycle_deletion.sql**
- `profiles.deletion_scheduled_at TIMESTAMPTZ NULL` + CHECK `(deletion_scheduled_at IS NULL) OR (status = 'active')` (RD-01).
- Partial index `idx_profiles_deletion_scheduled_at WHERE deletion_scheduled_at IS NOT NULL` (N-2).
- `public.employee_lifecycle_log` table — append-only audit log. FKs: actor/target profile ON DELETE SET NULL; target_company ON DELETE RESTRICT.
- RLS on log: SELECT for company admin (target_company_id scoped) and platform admin. No INSERT/UPDATE/DELETE for authenticated.
- `GRANT SELECT TO authenticated; REVOKE ALL FROM PUBLIC` on log (service_role inherits from 20260818000001 default privileges).
- `CREATE EXTENSION IF NOT EXISTS pg_cron` — must also be enabled in Supabase Dashboard.
- Five SECURITY DEFINER RPCs (all REVOKE PUBLIC, GRANT TO service_role except where noted):
  - `soft_delete_employee(uuid)` — guards G1,G2,G3,G7,G14,G15; writes soft_deleted log; sets deletion_scheduled_at.
  - `hard_delete_employee(uuid)` — guards G1,G2,G3,G7,G15; writes hard_deleted log BEFORE DELETE; deletes profiles row.
  - `cancel_scheduled_deletion(uuid)` — guards G1,G2,G16; optimistic-lock conditional UPDATE; writes deletion_undone log.
  - `cancel_invite(uuid)` — guards G1,G2,G17; writes invite_cancelled BEFORE DELETE; deletes pending profiles row.
  - `_promote_scheduled_deletions()` — cron-only, no auth.uid() guards, platform admin skip guard, returns int count.
- `cron.schedule('promote-scheduled-deletions', '*/5 * * * *', ...)` — scheduled via `SELECT cron.schedule(...)`.

**Why:** Soft-delete requires nullable profile_id in team_members (tombstone design per FR-15). Hard delete with ON DELETE CASCADE would destroy membership data. Surrogate PK required because composite PK cannot contain NULL.

**How to apply in future migrations:**
- team_members now has a surrogate `id` UUID PK. Any query building on (team_id, profile_id) as PK should use `id` as the row identifier.
- boards.created_by is written at board creation time — `create_team_with_board` RPC needs updating by backend agent.
- pg_cron is now installed; future maintenance jobs can use cron.schedule() directly.
- employee_lifecycle_log is the central audit table — all lifecycle events must write here via service-role INSERT.
