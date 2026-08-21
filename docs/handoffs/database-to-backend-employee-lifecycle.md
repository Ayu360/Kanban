# Employee Lifecycle — Database to Backend Handoff

**Migration files:**
- `supabase/migrations/20260819000001_team_members_surrogate_pk.sql`
- `supabase/migrations/20260819000002_employee_lifecycle_deletion.sql`

**Status:** DATABASE LAYER IMPLEMENTED — READY FOR BACKEND INTEGRATION
**Date:** 2026-08-20
**Prepared by:** Database Agent
**PRD:** `docs/prd/05-employee-lifecycle-deletion.md`

---

## Overview

The Employee Lifecycle module adds soft-delete, hard-delete, cancel-invite, and cancel-scheduled-deletion operations to the Employees module. It also introduces a pg_cron-driven grace-window promotion mechanism and an append-only audit log.

Two migrations ship together as Phase 1:

- `20260819000001_team_members_surrogate_pk.sql` — structural prerequisite. Replaces the composite PK `(team_id, profile_id)` on `team_members` with a surrogate UUID PK, changes the `profile_id` FK from CASCADE to SET NULL, and adds `boards.created_by`. Must deploy before the deletion RPCs.
- `20260819000002_employee_lifecycle_deletion.sql` — the lifecycle layer. Adds `profiles.deletion_scheduled_at`, the `employee_lifecycle_log` table, five SECURITY DEFINER RPCs, and the pg_cron job.

---

## Files Created

| File | Description |
|---|---|
| `supabase/migrations/20260819000001_team_members_surrogate_pk.sql` | Surrogate PK, FK → SET NULL, boards.created_by |
| `supabase/migrations/20260819000002_employee_lifecycle_deletion.sql` | Deletion column, log table, RPCs, pg_cron |
| `docs/handoffs/database-to-backend-employee-lifecycle.md` | This file |
| `docs/handoffs/database-to-frontend-teams-tombstone.md` | Frontend Teams change spec |

---

## Schema Changes Summary

### Modified: `public.profiles`

| Column | Type | Added | Notes |
|---|---|---|---|
| `deletion_scheduled_at` | `timestamptz NULL` | 20260819000002 | Non-null = in soft-delete grace window. CHECK: IS NULL OR status = 'active'. |

**Constraint added:** `profiles_deletion_scheduled_at_check` — `(deletion_scheduled_at IS NULL) OR (status = 'active')`.

### Modified: `public.team_members`

| Change | Detail |
|---|---|
| New column `id uuid NOT NULL DEFAULT gen_random_uuid()` | Surrogate PK. Existing rows backfilled automatically. |
| Primary key changed | From `(team_id, profile_id)` to `id` (surrogate). |
| UNIQUE constraint added | `team_members_team_profile_unique UNIQUE (team_id, profile_id)` — default NULLS DISTINCT. Multiple tombstone rows (profile_id = NULL) per team are permitted. |
| `profile_id` now nullable | Was NOT NULL (implied by composite PK). Now allows NULL tombstones. |
| FK `team_members_profile_id_fkey` changed | From `ON DELETE CASCADE` to `ON DELETE SET NULL`. |
| Trigger `check_team_member_company_match` updated | Short-circuits with `RETURN NEW` when `NEW.profile_id IS NULL`. |

### Modified: `public.boards`

| Column | Type | Added | Notes |
|---|---|---|---|
| `created_by` | `uuid NULL` | 20260819000001 | FK to profiles ON DELETE SET NULL. Existing rows: NULL. Written by create_team_with_board (backend must update RPC). |

### New: `public.employee_lifecycle_log`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid NOT NULL DEFAULT gen_random_uuid()` | Primary key |
| `actor_profile_id` | `uuid NULL` | Admin who performed the action. NULL if actor's profile was deleted. ON DELETE SET NULL. |
| `target_profile_id` | `uuid NULL` | Affected employee. NULL after hard deletion. ON DELETE SET NULL. |
| `target_email` | `text NOT NULL` | Captured at write time. Survives profile deletion. |
| `target_company_id` | `uuid NOT NULL` | Captured at write time. Used for RLS scoping post-deletion. ON DELETE RESTRICT (companies). |
| `action` | `text NOT NULL` | CHECK constraint — see valid values below. |
| `metadata` | `jsonb NULL` | Optional context (e.g., `{ "deletion_scheduled_at": "..." }` for soft_deleted). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Append time. Never updated. |

**Valid action values:** `invite_sent`, `invite_cancelled`, `invite_resent`, `invite_accepted`, `role_changed`, `deactivated`, `reactivated`, `soft_deleted`, `hard_deleted`, `deletion_undone`.

---

## Public Contract — RPCs

All RPCs are `SECURITY DEFINER`, `SET search_path = ''`, callable by `service_role` only unless noted. Call via the service-role Supabase client: `supabaseAdmin.rpc('rpc_name', { params })`.

### `soft_delete_employee(p_target_profile_id uuid) RETURNS jsonb`

Initiates a 24-hour grace window. Sets `deletion_scheduled_at = now() + interval '24 hours'`. Writes `soft_deleted` log entry.

**Returns on success:**
```json
{ "success": true, "deletion_scheduled_at": "2026-08-21T12:00:00Z" }
```

**Guards and error codes:**

| Guard | Condition | ERRCODE | Message prefix |
|---|---|---|---|
| G1 | Caller not admin/platform-admin | `insufficient_privilege` | `permission_denied:` |
| G2 | Cross-company target (non-platform-admin) | `insufficient_privilege` | `cross_company_denied:` |
| G3 | Self-delete as last active admin | `check_violation` | `last_admin_lockout:` |
| G7 | Target is platform admin | `insufficient_privilege` | `platform_admin_protected:` |
| G14 | Target status not 'active' | `invalid_parameter_value` | `invalid_state_for_soft_delete:` |
| G15 | Target status is 'pending' | `invalid_parameter_value` | `cannot_delete_pending:` |
| — | Target not found | `no_data_found` | `target_not_found:` |

### `hard_delete_employee(p_target_profile_id uuid) RETURNS jsonb`

Immediately deletes the profiles row. Writes `hard_deleted` log entry BEFORE the DELETE. Does NOT delete auth.users (backend's responsibility).

**Returns on success:**
```json
{ "success": true }
```

**Guards and error codes:**

| Guard | Condition | ERRCODE | Message prefix |
|---|---|---|---|
| G1 | Caller not admin/platform-admin | `insufficient_privilege` | `permission_denied:` |
| G2 | Cross-company target | `insufficient_privilege` | `cross_company_denied:` |
| G3 | Self-delete as last active admin | `check_violation` | `last_admin_lockout:` |
| G7 | Target is platform admin | `insufficient_privilege` | `platform_admin_protected:` |
| G15 | Target status is 'pending' | `invalid_parameter_value` | `cannot_delete_pending:` |
| — | Target not found | `no_data_found` | `target_not_found:` |

**Note on deactivated profiles:** Hard delete of a deactivated profile is permitted. G15 only blocks pending profiles.

### `cancel_scheduled_deletion(p_target_profile_id uuid) RETURNS jsonb`

Aborts a soft-delete grace window. Clears `deletion_scheduled_at = NULL`. Status remains `'active'` (only legal pre-soft-delete status per RD-01). Writes `deletion_undone` log entry.

**Returns on success:**
```json
{ "success": true, "noop": false }
```

**Returns when cron already promoted (EC-07 concurrency race):**
```json
{ "success": false, "reason": "already_deleted" }
```

**Guards and error codes:**

| Guard | Condition | ERRCODE | Message prefix |
|---|---|---|---|
| G1 | Caller not admin/platform-admin | `insufficient_privilege` | `permission_denied:` |
| G2 | Cross-company target | `insufficient_privilege` | `cross_company_denied:` |
| G16 | Target not found (already deleted by cron) | — | Returns `{ success: false, reason: 'already_deleted' }` (no raise) |

### `cancel_invite(p_target_profile_id uuid) RETURNS jsonb`

Deletes a pending invitation's profiles row. Writes `invite_cancelled` log entry BEFORE the DELETE. Does NOT delete auth.users.

**Returns on success:**
```json
{ "success": true }
```

**Guards and error codes:**

| Guard | Condition | ERRCODE | Message prefix |
|---|---|---|---|
| G1 | Caller not admin/platform-admin | `insufficient_privilege` | `permission_denied:` |
| G2 | Cross-company target | `insufficient_privilege` | `cross_company_denied:` |
| G17 | Target not pending (race: invitee already accepted) | `invalid_parameter_value` | `not_pending:` |
| — | Target not found | `no_data_found` | `target_not_found:` |

### `_promote_scheduled_deletions() RETURNS integer`

Internal cron function. Not callable from Server Actions. Returns count of profiles deleted.

---

## Error Code to User-Message Map

Use these in the Server Action's error normalization layer (ADR-0004):

| SQLSTATE | Message prefix to detect | User-visible message |
|---|---|---|
| `insufficient_privilege` | `permission_denied:` | "You do not have permission to perform this action." |
| `check_violation` | `last_admin_lockout:` | "You must promote another admin before deleting your own account." |
| `insufficient_privilege` | `platform_admin_protected:` | "Platform admin accounts cannot be deleted." |
| `invalid_parameter_value` | `cannot_delete_pending:` | "This invitation must be cancelled, not deleted. Use 'Cancel Invite' instead." |
| `invalid_parameter_value` | `invalid_state_for_soft_delete:` | "Only active employees can be scheduled for deletion." |
| `invalid_parameter_value` | `not_pending:` | "This invitation has already been accepted. Refresh the page and manage the employee from the active employees list." |
| `no_data_found` | `target_not_found:` | "Employee not found. The page may be out of date — please refresh." |
| n/a | `{ success: false, reason: 'already_deleted' }` | "This account has already been deleted and cannot be restored." |
| anything else | — | "Something went wrong. Please try again or contact support." |

---

## Sequencing Requirements

### S-2: hardDeleteEmployeeAction — ban-BEFORE-delete, auth-delete-AFTER

**Critical:** a deleted user's JWT remains valid for up to 1 hour after the profiles row is gone unless their Auth account is banned first. Session refresh will fail (Supabase returns 401) only when the JWT TTL expires or the token is refreshed against a now-deleted auth.users row.

```
hardDeleteEmployeeAction sequence:
  1. supabaseAdmin.auth.admin.banUser(targetProfileId)      // revoke session immediately
  2. supabaseAdmin.rpc('hard_delete_employee', { p_target_profile_id })  // DB delete
  3. supabaseAdmin.auth.admin.deleteUser(targetProfileId)   // remove auth identity
```

If step 1 fails: abort — do not proceed. Profile is untouched.
If step 2 fails: call `auth.admin.updateUserById({ ban_duration: 'none' })` to unban (rollback). Profile is untouched.
If step 3 fails: profile is deleted, auth.users row is orphaned. Log the orphan for the auth-sweep cron to clean up. See Remediation Queries section.

### softDeleteEmployeeAction — ban-AFTER-RPC

```
softDeleteEmployeeAction sequence:
  1. supabaseAdmin.rpc('soft_delete_employee', { p_target_profile_id })  // sets deletion_scheduled_at
  2. supabaseAdmin.auth.admin.banUser(targetProfileId)      // revoke access immediately (RD-02)
```

If step 1 fails: abort. Auth is not touched.
If step 2 fails: profile is in grace window but user can still log in. Log the inconsistency. The next JWT refresh will carry status = 'active' (no middleware block). Retry the ban or manually ban via Supabase Dashboard.

### undoScheduledDeletionAction — unban-AFTER-RPC

```
undoScheduledDeletionAction sequence:
  1. supabaseAdmin.rpc('cancel_scheduled_deletion', { p_target_profile_id })
     // Returns { success: false, reason: 'already_deleted' } if cron beat you
  2. If success: supabaseAdmin.auth.admin.updateUserById(targetProfileId, { ban_duration: 'none' })
```

If RPC returns `{ success: false, reason: 'already_deleted' }`: show "account already deleted" error. Do not call unban.
If unban (step 2) fails: profile shows active in DB but auth still blocks login. Retry unban or manually unban via Dashboard.

### cancelInviteAction — RPC-then-Auth

```
cancelInviteAction sequence:
  1. supabaseAdmin.rpc('cancel_invite', { p_target_profile_id })  // deletes profiles row
  2. supabaseAdmin.auth.admin.deleteUser(targetProfileId)         // delete auth identity
```

If step 1 fails: abort. Auth is untouched.
If step 2 fails: profiles row is deleted but auth.users row persists. The invite link is invalid (no profiles row to activate). The orphaned auth.users row will be swept by the auth-sweep cron. Log the failure for visibility.

Note on EC-08: The PRD spec (EC-08) originally called for auth.admin.deleteUser FIRST, then profiles DELETE. Since cancel_invite is now an RPC wrapping the profiles DELETE, the sequencing necessarily changes to RPC-first (profiles gone) then auth-delete. The risk (orphaned auth.users) is bounded: the auth-sweep cron cleans these up within 24 hours on Supabase Pro (5-minute interval), or within 1 day on Hobby (see Deploy Notes).

---

## Auth-Sweep Spec

The pg_cron job deletes profiles rows but cannot call the Supabase Auth admin HTTP API from inside PostgreSQL. Orphaned `auth.users` rows (no corresponding `profiles` row) must be cleaned up by a separate Vercel cron endpoint.

**Endpoint:** `src/app/api/cron/sweep-orphaned-auth/route.ts` (GET handler)

**Vercel cron config** (`vercel.json`):
```json
{
  "crons": [
    { "path": "/api/cron/sweep-orphaned-auth", "schedule": "*/5 * * * *" }
  ]
}
```

**Auth:** Vercel `CRON_SECRET` header check. The handler must verify `request.headers.get('authorization') === 'Bearer ' + process.env.CRON_SECRET`. Reject all other requests with 401.

**Logic:**
1. Use service-role Supabase client.
2. List auth.users via `supabaseAdmin.auth.admin.listUsers()` (paginate if > 1000 users).
3. For each auth.users row where `created_at < now() - interval '10 minutes'`: query `public.profiles` for a matching `id`.
4. If no matching profile exists: call `supabaseAdmin.auth.admin.deleteUser(authUserId)`.
5. Log the count of orphaned rows swept per invocation.

**10-minute grace window (auth-sweep race):** If the cron promotes a soft-delete for user X at time T, and an admin re-invites user X (creating a fresh `auth.users` row) at time T+2min, the auth-sweep running at T+5min would see the fresh `auth.users` row with no matching profile (the profile hasn't been created yet — inviteEmployeeAction creates it separately) and incorrectly delete it. The 10-minute grace ensures newly created auth.users rows are never swept before the corresponding inviteEmployeeAction has had time to create the profiles row. This is a hard constraint: do NOT sweep auth.users rows where `created_at >= now() - interval '10 minutes'`.

**Vercel plan note:** The Vercel Hobby plan restricts cron jobs to once per day (midnight UTC). If the user is on Hobby, change the schedule to `"0 0 * * *"` (daily). Auth cleanup is not time-critical — orphaned auth rows cannot log in (no profiles row = no JWT claims = middleware block). The 24-hour cleanup window is acceptable. Confirm the Vercel plan before deploying the cron config.

---

## New Risks (Reviewer-Identified)

### R-NEW-1: Auth-sweep race with resend-invite

When pg_cron promotes a soft-deleted profile, then an admin re-invites the same email before the auth-sweep runs, the auth-sweep would see the new `auth.users` row (no profile yet) and delete it.

**Mitigation:** The auth-sweep endpoint MUST apply a 10-minute grace window: only sweep `auth.users` rows where `created_at < now() - interval '10 minutes'`. This is documented in the auth-sweep logic spec above and must not be omitted.

### R-NEW-2: Migration reversibility constraint

After both Phase 1 migrations are deployed, they cannot be rolled back independently.

**Constraint:** Rollback of `20260819000001` requires prior rollback of `20260819000002`. The RPCs in 20260819000002 reference the `team_members` surrogate PK and `boards.created_by` column which are added by 20260819000001. If 20260819000001 is rolled back without rolling back 20260819000002 first, the RPCs will reference columns that no longer exist.

**Deploy runbook must state:** "Rollback of 20260819000001 requires prior rollback of 20260819000002."

### R-NEW-3: Admin-vs-admin race (two admins on same profile)

Two admins could simultaneously attempt conflicting operations on the same profile. Examples:
- Admin A cancels invite while Admin B tries to hard-delete (G15 blocks B after A's RPC wins).
- Admin A initiates cancel_scheduled_deletion while the pg_cron job promotes the deletion (cancel_scheduled_deletion returns `{ success: false, reason: 'already_deleted' }` rather than raising).

**This is acceptable behavior, not a bug.** The DB-layer guards ensure whichever RPC runs second sees a consistent error and returns a meaningful result. The UI should refresh the employee row after any error and let the admin re-decide based on the current state. Do NOT retry the failed operation automatically — the state has changed and requires human judgment.

### R-02 (inherited): Orphaned profiles row on partial failure

If `hard_delete_employee` succeeds (profiles row deleted) but `auth.admin.deleteUser` fails, an orphaned `auth.users` row remains with no corresponding profile. The user cannot log in (no profiles row → JWT hook returns no claims → middleware blocks). The orphaned row will be cleaned up by the auth-sweep cron. However, the email address is NOT immediately freeable for re-invitation until the auth.users row is gone.

**Manual remediation query:**
```sql
-- Find auth.users rows with no matching profiles row (orphaned auth identities).
SELECT u.id, u.email, u.created_at
FROM   auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE  p.id IS NULL
ORDER BY u.created_at DESC;

-- After confirming each row is genuinely orphaned (no pending invite in flight),
-- delete via: supabaseAdmin.auth.admin.deleteUser(orphanedUserId)
-- Do NOT run DELETE directly on auth.users from SQL — use the Admin API.
```

---

## Existing Server Actions to Extend (Audit Log Backfill Forward)

These actions must be extended to write audit log entries. No functional behavior changes — the log write is additive. All actions already use the service-role client.

| Action | Log action to write | Extra metadata |
|---|---|---|
| `inviteEmployeeAction` | `invite_sent` | None |
| `changeRoleAction` | `role_changed` | `{ "old_role": "...", "new_role": "..." }` |
| `deactivateEmployeeAction` | `deactivated` | None |
| `reactivateEmployeeAction` | `reactivated` | None |
| Accept-invite callback (activate_invited_employee path) | `invite_accepted` | None |

Log write pattern (service-role INSERT into `public.employee_lifecycle_log`):
```typescript
await supabaseAdmin
  .from('employee_lifecycle_log')
  .insert({
    actor_profile_id: callerProfileId,  // null-safe: use null if not available
    target_profile_id: targetProfileId,
    target_email: targetEmail,          // must be captured before any delete
    target_company_id: targetCompanyId,
    action: 'invite_sent',              // use the enum value from the CHECK constraint
    metadata: null,                     // or { key: value } for rich events
  });
```

For `resendInviteAction` (when implemented): write `invite_resent` log entry.

---

## create_team_with_board RPC — Required Update

The `boards.created_by` column was added in `20260819000001` but the `create_team_with_board` RPC (in `20260809000001`) does not yet write to it. The backend agent should update the RPC to pass `auth.uid()` as `created_by` at board creation time. This is a DB-layer change; coordinate with the database agent or update via a new migration.

Until this update ships, all new boards will have `created_by = NULL`. This is consistent with the behavior for pre-migration boards and does not block the lifecycle deletion feature.

---

## Deploy Notes

### pg_cron Dashboard step

pg_cron must be enabled in the Supabase Dashboard BEFORE the migration runs in production:

1. Open Supabase Dashboard → Database → Extensions.
2. Search for "pg_cron" and enable it.
3. Then run `20260819000002_employee_lifecycle_deletion.sql`.

If the migration runs before the Dashboard step on a plan where the postgres role lacks extension creation privileges, `CREATE EXTENSION IF NOT EXISTS pg_cron` will fail with `ERROR: permission denied to create extension "pg_cron"`. The migration must be re-run after enabling the extension.

### Vercel cron plan requirement

Vercel cron frequency is plan-dependent:
- Hobby: once per day only. Use schedule `"0 0 * * *"`.
- Pro and above: `*/5 * * * *` (every 5 minutes) is supported.

The auth-sweep endpoint is not time-critical for security (orphaned auth rows cannot log in). Daily cleanup on Hobby is acceptable. Confirm the Vercel plan and adjust `vercel.json` accordingly.

### Migration deploy order

```
20260818000001_grant_service_role_table_privileges.sql  (already deployed)
  ↓
20260819000001_team_members_surrogate_pk.sql            (deploy first)
  ↓
20260819000002_employee_lifecycle_deletion.sql           (deploy second)
```

Do NOT deploy 20260819000002 without 20260819000001 — the deletion RPCs reference `team_members.id` (surrogate PK) behavior and `boards.created_by` implicitly via FK SET NULL during profile deletion.

### Rollback constraint

Rollback of `20260819000001` requires prior rollback of `20260819000002`. See each migration file's rollback stub for exact DDL sequences. Never roll back on production with live data.

---

## Smoke Test Results (to be filled in after first deploy)

Run these queries immediately after applying both migrations and paste the output here:

**Test 1 — service_role can INSERT into employee_lifecycle_log:**
```sql
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.employee_lifecycle_log (target_email, target_company_id, action)
VALUES ('smoke@test.invalid', '00000000-0000-0000-0000-000000000001', 'invite_sent');
-- Expected: INSERT 0 1
ROLLBACK;
```
Result: `[paste output]`

**Test 2 — pg_cron job registered:**
```sql
SELECT jobname, schedule, command FROM cron.job
WHERE jobname = 'promote-scheduled-deletions';
```
Result: `[paste output — expected: 1 row]`

**Test 3 — pg_cron extension installed:**
```sql
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
```
Result: `[paste output — expected: 1 row]`

**Test 4 — team_members surrogate PK column exists:**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'team_members'
  AND column_name  = 'id';
```
Result: `[paste output — expected: 1 row, data_type uuid, is_nullable NO]`

**Test 5 — boards.created_by column exists with correct FK:**
```sql
SELECT kcu.column_name, ccu.table_name AS references_table, rc.delete_rule
FROM information_schema.key_column_usage kcu
JOIN information_schema.constraint_column_usage ccu
     ON ccu.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
     ON rc.constraint_name = kcu.constraint_name
WHERE kcu.table_schema = 'public'
  AND kcu.table_name   = 'boards'
  AND kcu.column_name  = 'created_by';
```
Result: `[paste output — expected: references_table=profiles, delete_rule=SET NULL]`
