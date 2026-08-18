# Service-Role Table Grants Fix — Database to Backend Handoff

**Migration file:** `supabase/migrations/20260818000001_grant_service_role_table_privileges.sql`
**Status:** READY TO DEPLOY — not yet applied to remote
**Date:** 2026-08-18
**Prepared by:** Database Agent

---

## Overview

This migration fixes a production bug where any Server Action that uses the
service-role supabase client to write directly to a `public.*` table raises
PostgreSQL error 42501 ("permission denied for table X"). The root cause is
that no prior migration granted table-level privileges to `service_role`.
SECURITY DEFINER functions masked the gap because they run as a superuser.
The bug surfaced as soon as a direct service-role INSERT was attempted.

---

## What Changed at the Database Layer

This migration makes three SQL changes. No schema, RLS, or function grants
are modified.

**1. `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role`**

Grants SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER to
`service_role` on every existing table in `public`. Tables affected:
`companies`, `profiles`, `teams`, `team_members`, `boards`, `columns`.

Views (`employee_directory`, `admin_employee_list`) already have correct grants
from `20260816000002_employees_schema.sql` and are untouched. The `ALL TABLES`
clause also reaches them, which is harmless — the existing grants remain and
no new behavior is introduced for views.

**2. `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role`**

No sequences exist today (all PKs are UUID). Included as a durability measure
so that any future table using a serial/bigserial PK does not produce a
confusing sequence-level 42501 on INSERT.

**3. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ... TO service_role`**

Instructs PostgreSQL to automatically apply these grants to every table and
sequence created in `public` by future migrations (which Supabase runs as
`postgres`). This prevents the same class of bug from recurring when new
tables (e.g., `tasks`) are added.

---

## Callers Unblocked

The following code paths failed with 42501 before this migration and will
work correctly after it is deployed:

| Caller | Table | Operation |
|--------|-------|-----------|
| `addMember` (SupabaseTeamsRepository, ~line 400) | `team_members` | INSERT |
| `removeMember` (SupabaseTeamsRepository) | `team_members` | DELETE |
| `deleteTeam` (SupabaseTeamsRepository) | `teams` | DELETE |
| Employee role change (employees Server Action) | `profiles` | UPDATE via RPC — already SECURITY DEFINER, unblocked as a side effect |
| Employee deactivation (employees Server Action) | `profiles` | UPDATE via RPC — same |
| Employee reactivation (employees Server Action) | `profiles` | UPDATE via RPC — same |
| Invite bootstrap (`create_profile_for_user`) | `profiles` | INSERT via SECURITY DEFINER — same |

Note: the RPC-based paths (role change, deactivation, reactivation, invite
bootstrap) are SECURITY DEFINER and were not directly broken. They are listed
here for completeness. The direct-INSERT and direct-DELETE paths
(`addMember`, `removeMember`, `deleteTeam`) were the actively failing callers.

---

## Deployment Steps

```bash
supabase db push
```

No additional steps are required. The migration is idempotent — GRANTs and
ALTER DEFAULT PRIVILEGES are no-ops if the privilege is already held. Safe
to run on production.

---

## Verification Checklist

After `supabase db push` completes, rerun the following flows as a platform
admin (or company admin) using the deployed application:

- [ ] **addMember** — navigate to a team, add a member via the AddMember flow.
      Assert the member appears in the team list without an error toast. The
      previously observed "FORBIDDEN: You do not have permission to perform
      this action" error must be gone.
- [ ] **removeMember** — remove a member from a team. Assert success.
- [ ] **deleteTeam** — delete a team. Assert it disappears from the team list.
- [ ] **Employee role change** — change an employee's role from `employee` to
      `admin` and back. Assert success on both directions.
- [ ] **Employee deactivation** — deactivate an employee. Assert status changes
      to `deactivated` in the admin list.
- [ ] **Employee reactivation** — reactivate the same employee. Assert status
      returns to `active`.
- [ ] **Invite flow** — invite a new employee. Assert the profile row is
      created with `status = 'pending'`.

If all seven checks pass, the migration is confirmed working.

---

## What Was Not Changed

- RLS policies: untouched. The security model is identical — service_role
  bypasses RLS by design; authenticated and anon roles are governed by the
  same policies as before.
- authenticated and anon grants: untouched.
- Function grants: untouched. `change_employee_role`, `deactivate_employee`,
  `reactivate_employee`, `create_team_with_board` already have their own
  explicit `GRANT EXECUTE TO service_role` in the migrations that created them.
- Schema: no tables, columns, or constraints were added or modified.

---

## Next Steps for Backend Agent

1. Deploy via `supabase db push`.
2. Run the verification checklist above.
3. Remove the temporary `console.error` diagnostic that was added to
   `src/features/teams/repositories/SupabaseTeamsRepository.ts` around the
   `addMember` INSERT (the root-cause investigation instrumentation).
4. If any item in the checklist fails, check that the service-role client
   is being used (not the anon-key client) for the failing call — a wrong
   client choice would not be fixed by this migration.
