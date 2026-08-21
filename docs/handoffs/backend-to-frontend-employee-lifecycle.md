# Backend → Frontend Handoff: Employee Lifecycle & Deletion (PRD 05)

**Status:** Backend implementation complete — ready for frontend integration.
**PRD:** `docs/prd/05-employee-lifecycle-deletion.md`
**Prepared by:** Backend Engineer
**Date:** 2026-08-20

---

## Overview

This handoff covers the Phase 2 (backend) implementation of PRD 05. It extends the Employees module with five new mutation hooks, augments five existing actions with audit logging, adds a `deletionScheduledAt` field to `AdminEmployee`, and provides the complete error-code → user-message map for all lifecycle operations.

The frontend must NOT be shipped before the DB migrations are applied in the correct order (see Deploy Notes).

---

## Completed Backend Work

### New files
- `src/features/employees/services/employeesLifecycleLog.ts` — audit log helper (`writeLifecycleLog`, `LogWriteError`)
- `src/features/employees/services/employeesLifecycleActions.ts` — 5 new Server Actions
- `src/app/api/cron/sweep-orphaned-auth/route.ts` — Vercel Cron auth-sweep endpoint
- `vercel.json` — Vercel Cron schedule config
- `supabase/migrations/20260820000001_admin_employee_list_add_deletion_scheduled.sql` — adds `deletion_scheduled_at` to `admin_employee_list` view
- `supabase/migrations/20260820000002_create_team_with_board_creator.sql` — updates `create_team_with_board` to write `boards.created_by`

### Modified files
- `src/features/employees/types/index.ts` — added `deletionScheduledAt` to `AdminEmployee`; added `LifecycleLogAction` union type; added new result types
- `src/features/employees/repositories/SupabaseEmployeesRepository.ts` — added `deletion_scheduled_at` to row type, mapper, and SELECT projections
- `src/features/employees/services/employeesActions.ts` — extended 5 existing actions with audit log writes

---

## Updated Type: `AdminEmployee`

```typescript
// src/features/employees/types/index.ts

interface AdminEmployee {
  id: string;
  companyId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: EmployeeStatus;             // 'active' | 'pending' | 'deactivated'
  deactivatedAt: string | null;       // ISO timestamp or null
  deletionScheduledAt: string | null; // NEW — ISO timestamp of grace window expiry, or null
  isPlatformAdmin: boolean;
  createdAt: string;
}
```

**Frontend impact:** Every place that renders an `AdminEmployee` row must now handle `deletionScheduledAt`. A non-null value means the employee is in the 24-hour soft-delete grace window. See "Status Badge" section below.

---

## New Server Actions

All are in `src/features/employees/services/employeesLifecycleActions.ts`. All are `'use server'`. All return `ActionResult<T>`.

### Import path

```typescript
import {
  softDeleteEmployeeAction,
  hardDeleteEmployeeAction,
  undoScheduledDeletionAction,
  cancelInviteAction,
  resendInviteAction,
} from '@/features/employees/services/employeesLifecycleActions';
```

### `softDeleteEmployeeAction(targetProfileId: string)`

Schedules an employee for deletion in 24 hours. Immediately revokes login access.

```typescript
const result = await softDeleteEmployeeAction(targetProfileId);
// result.success === true → result.data: { deletionScheduledAt: string }
// result.success === false → result.error: { code, message }
```

**Side effects:** sets `profiles.deletion_scheduled_at`; bans the Auth account.
**Cache invalidation:** invalidate `employeesQueryKeys.lists()` and `employeesQueryKeys.detail(id)`.

### `hardDeleteEmployeeAction(targetProfileId: string)`

Immediately and irreversibly deletes an employee's profile and auth identity.

```typescript
const result = await hardDeleteEmployeeAction(targetProfileId);
// result.success === true → result.data: { success: true }
// result.success === false → result.error: { code, message }
```

**Side effects:** deletes `profiles` row; deletes `auth.users` row. Team memberships become tombstones (`profile_id = NULL`). Board `created_by` becomes NULL.
**Cache invalidation:** invalidate `employeesQueryKeys.lists()` and `employeesQueryKeys.detail(id)`.
**Irreversible.** Show a strong confirmation dialog (variant='destructive').

### `undoScheduledDeletionAction(targetProfileId: string)`

Cancels a soft-delete grace window and restores login access.

```typescript
const result = await undoScheduledDeletionAction(targetProfileId);
// result.success === true → result.data: { cancelled: boolean; reason?: 'already_deleted' }
// result.success === false → result.error: { code, message }
```

**Race case:** if `result.success === true && result.data.cancelled === false && result.data.reason === 'already_deleted'`, the pg_cron job promoted the deletion before the cancel arrived. Show the race-condition error copy (see Error Map below).

**Side effects:** clears `profiles.deletion_scheduled_at`; unbans the Auth account.
**Cache invalidation:** invalidate `employeesQueryKeys.lists()` and `employeesQueryKeys.detail(id)`.

### `cancelInviteAction(targetProfileId: string)`

Cancels a pending invitation. Deletes the profile and auth identity.

```typescript
const result = await cancelInviteAction(targetProfileId);
// result.success === true → result.data: { success: true }
// result.success === false → result.error: { code, message }
```

**Side effects:** deletes `profiles` row; deletes `auth.users` row. Frees the email for re-invitation.
**Cache invalidation:** invalidate `employeesQueryKeys.lists()`.
**Only valid** on rows with `status === 'pending'`.

### `resendInviteAction(targetProfileId: string, email: string)`

Resends an invitation email, refreshing the invite token.

```typescript
const result = await resendInviteAction(targetProfileId, email);
// result.success === true → result.data: { success: true }
// result.success === false → result.error: { code, message }
```

**Side effects:** sends a new invite email; writes `invite_resent` audit log entry.
**No cache invalidation needed** — the profile row is unchanged.
**Only valid** on rows with `status === 'pending'` (enforced by the action).

---

## New TanStack Query Hooks Required (frontend's job)

Build these 5 mutation hooks following the pattern in `src/features/employees/hooks/useDeactivateEmployee.ts`.

### `useSoftDeleteEmployee`

```typescript
// File: src/features/employees/hooks/useSoftDeleteEmployee.ts
import { softDeleteEmployeeAction } from '../services/employeesLifecycleActions';
import { employeesQueryKeys } from './useEmployees';

// mutationFn: (targetProfileId: string) => softDeleteEmployeeAction(targetProfileId)
// onSuccess: invalidate lists() + detail(targetProfileId)
// Return type: ActionResult<SoftDeleteResult>
```

### `useHardDeleteEmployee`

```typescript
// File: src/features/employees/hooks/useHardDeleteEmployee.ts
// mutationFn: (targetProfileId: string) => hardDeleteEmployeeAction(targetProfileId)
// onSuccess: invalidate lists() + detail(targetProfileId)
// Return type: ActionResult<HardDeleteResult>
```

### `useUndoScheduledDeletion`

```typescript
// File: src/features/employees/hooks/useUndoScheduledDeletion.ts
// mutationFn: (targetProfileId: string) => undoScheduledDeletionAction(targetProfileId)
// onSuccess: invalidate lists() + detail(targetProfileId)
// Return type: ActionResult<UndoScheduledDeletionResult>
// Special: check result.data.cancelled === false && result.data.reason === 'already_deleted'
```

### `useCancelInvite`

```typescript
// File: src/features/employees/hooks/useCancelInvite.ts
// mutationFn: (targetProfileId: string) => cancelInviteAction(targetProfileId)
// onSuccess: invalidate lists()
// Return type: ActionResult<CancelInviteResult>
```

### `useResendInvite`

```typescript
// File: src/features/employees/hooks/useResendInvite.ts
// mutationFn: ({ targetProfileId, email }: { targetProfileId: string; email: string }) =>
//               resendInviteAction(targetProfileId, email)
// No cache invalidation needed (profile row unchanged)
// Return type: ActionResult<ResendInviteResult>
```

---

## Extended Existing Actions (audit-log only, no shape change)

The following 5 existing actions now write audit log entries after their primary operation succeeds. **No change to their signatures, return types, or error contracts.**

| Action | Log action written |
|---|---|
| `inviteEmployeeAction` | `invite_sent` |
| `changeEmployeeRoleAction` | `role_changed` (metadata: `{ old_role, new_role }`) |
| `deactivateEmployeeAction` | `deactivated` |
| `reactivateEmployeeAction` | `reactivated` |
| `activateInvitedEmployeeAction` | `invite_accepted` |

The frontend hooks for these actions require no changes.

---

## Error-Code → User-Message Map

All new lifecycle actions follow the `ActionResult` contract. When `result.success === false`, use `result.error.message` directly — it is already user-safe. The table below maps the semantic error to the message the backend returns and the recommended UI treatment.

| Error code | Message (from `result.error.message`) | Recommended UI treatment |
|---|---|---|
| `FORBIDDEN` / permission_denied | "You do not have permission to perform this action." | Toast or inline error |
| `FORBIDDEN` / last_admin_lockout | "You must promote another admin before deleting your own account." | Toast — explain the required step |
| `FORBIDDEN` / platform_admin_protected | "Platform admin accounts cannot be deleted." | Toast |
| `FORBIDDEN` / cross_company | "You cannot perform this action on an employee in a different company." | Toast |
| `VALIDATION_ERROR` / cannot_delete_pending | "This invitation must be cancelled, not deleted. Use 'Cancel Invite' instead." | Toast |
| `VALIDATION_ERROR` / invalid_state_for_soft_delete | "Only active employees can be scheduled for deletion." | Toast |
| `VALIDATION_ERROR` / not_pending (cancel invite) | "This invitation has already been accepted. Refresh the page and manage the employee from the active employees list." | Toast + trigger list refetch |
| `VALIDATION_ERROR` / not_pending (resend) | "This employee has already accepted their invitation. No new invite email was sent." | Toast + trigger list refetch |
| `NOT_FOUND` / target_not_found | "Employee not found. The page may be out of date — please refresh." | Toast + trigger list refetch |
| `UNAUTHENTICATED` | "You must be signed in to perform this action." | Redirect to `/login` |
| `UNKNOWN_ERROR` | "Something went wrong. Please try again or contact support." | Toast |

### Race condition: `undoScheduledDeletion` returns `already_deleted`

When `result.success === true` but `result.data.cancelled === false && result.data.reason === 'already_deleted'`:

```typescript
if (result.success && !result.data.cancelled && result.data.reason === 'already_deleted') {
  // Show: "This account has already been deleted and cannot be restored."
  // Trigger employee list refetch — the row should no longer appear.
}
```

---

## New Future Query Key

If an audit log UI is added in a future sprint, the recommended key is:

```typescript
// Add to employeesQueryKeys in useEmployees.ts
employeesQueryKeys.lifecycleLog = (companyId: string) =>
  ['employees', 'lifecycle-log', companyId] as const;
```

No query hook is needed in this phase (no UI surface for the log yet).

---

## Status Badge: "Deletion Scheduled"

**Condition:** `employee.deletionScheduledAt !== null`

The `deletionScheduledAt` field is now populated in `AdminEmployee` from the `admin_employee_list` view (gap a fix). Use it to render a fourth status badge variant.

**Design spec (from PRD 05 UX Spec):**
- Label: "Deletion Scheduled"
- Color: amber / warning
- Tooltip: show the scheduled deletion timestamp formatted as a human-readable date/time (e.g., "Scheduled for Aug 21, 2026 at 12:00 PM UTC")
- Parsing: `new Date(employee.deletionScheduledAt)` — it is an ISO 8601 UTC string.

**Precedence:** The "Deletion Scheduled" badge takes precedence over the "Active" badge. A profile in the grace window has `status === 'active'` — the badge is derived from `deletionScheduledAt`, NOT from `status`.

---

## Row Action Menu Changes (from PRD 05 UX Spec)

The existing kebab/actions menu must be updated per employee status:

### For active employees (`status === 'active'` AND `deletionScheduledAt === null`)

Add two new items below the existing Deactivate action:
- **"Schedule Deletion"** → opens soft-delete confirmation dialog → `useSoftDeleteEmployee`
- **"Delete Now"** → opens hard-delete confirmation dialog → `useHardDeleteEmployee`

Both items are hidden (not disabled) on the admin's own row when no other active admin exists.
Both items are hidden on platform admin rows.

### For pending employees (`status === 'pending'`)

Replace existing action items with:
- **"Cancel Invite"** → opens cancel-invite confirmation dialog → `useCancelInvite`
- **"Resend Invite"** → opens resend-invite confirmation dialog → `useResendInvite`

Remove: Promote/Demote, Deactivate/Reactivate (not applicable to pending profiles).

### For employees in soft-delete grace window (`deletionScheduledAt !== null`)

Show only one action:
- **"Cancel Scheduled Deletion"** → opens undo-deletion confirmation dialog → `useUndoScheduledDeletion`

All other actions are disabled / hidden for these rows.

### For platform admin rows (visible only to platform admins)

All deletion menu items are absent. No confirmation dialog is ever shown.

---

## Confirmation Dialogs (from PRD 05 UX Spec)

All dialogs use the existing `EmployeeConfirmDialog` component.

**Hard Delete:**
```
Title: "Permanently Delete Employee"
Body:  "This will permanently remove [name] ([email]) from the system. Their team
        memberships will be preserved for you to clean up manually. This action
        cannot be undone."
Confirm: "Delete Permanently"  variant='destructive'
Cancel:  "Cancel"
```

**Soft Delete (Schedule Deletion):**
```
Title: "Schedule Deletion"
Body:  "This will schedule [name] ([email]) for permanent deletion in 24 hours.
        Their access will be revoked immediately. You can cancel the deletion
        during this 24-hour window."
Confirm: "Schedule Deletion"  variant='destructive'
Cancel:  "Cancel"
```

**Cancel Scheduled Deletion:**
```
Title: "Cancel Scheduled Deletion"
Body:  "This will cancel the scheduled deletion for [name] ([email]) and restore
        their access."
Confirm: "Cancel Deletion"  variant='default'
Cancel:  "Dismiss"
```

**Cancel Invite:**
```
Title: "Cancel Invitation"
Body:  "This will cancel the pending invitation for [email] and remove their account.
        They will no longer be able to use the invite link."
Confirm: "Cancel Invitation"  variant='destructive'
Cancel:  "Keep Invitation"
```

**Resend Invite:**
```
Title: "Resend Invitation"
Body:  "This will send a fresh invitation to [email]. The previous invite link will
        no longer work."
Confirm: "Resend"  variant='default'
Cancel:  "Cancel"
```

---

## Race-Condition UX Notes

### `undoScheduledDeletion` — already_deleted

When `result.data.reason === 'already_deleted'` (the pg_cron job promoted the deletion before the cancel arrived):
- Show toast: "This account has already been deleted and cannot be restored."
- Trigger `invalidateQueries({ queryKey: employeesQueryKeys.lists() })` — the row no longer exists and should disappear from the list.
- Do NOT show a retry button — the state has changed irreversibly.

### `cancelInvite` — not_pending race

When `result.error.message` contains "This invitation has already been accepted":
- Show toast with the message.
- Trigger list refetch — the employee is now active.
- The admin should use the standard Deactivate action if needed.

---

## Teams Tombstone UI (separate handoff)

The DB migration `20260819000001_team_members_surrogate_pk.sql` changed `team_members.profile_id` from NOT NULL to nullable (`ON DELETE SET NULL`). See `docs/handoffs/database-to-frontend-teams-tombstone.md` for the Teams module UI requirements. Key point: any place that renders team members must handle `profile_id === null` and show `[Deleted User]`.

---

## Deploy Notes

### Migration order (strict)

```
20260819000001_team_members_surrogate_pk.sql           (already queued)
20260819000002_employee_lifecycle_deletion.sql          (already queued)
20260820000001_admin_employee_list_add_deletion_scheduled.sql  (this sprint)
20260820000002_create_team_with_board_creator.sql              (this sprint)
```

Do NOT deploy the new Server Actions against a database that does not have 20260819000002 applied — the `soft_delete_employee`, `hard_delete_employee`, `cancel_scheduled_deletion`, and `cancel_invite` RPCs do not exist without it.

### Vercel environment variable

Add `CRON_SECRET` to Vercel environment variables (Settings → Environment Variables). Use a strong random value (e.g., `openssl rand -hex 32`). This is required for the auth-sweep cron endpoint to function.

For local development, add to `.env.local`:
```
CRON_SECRET=any-local-secret-value
```

### Vercel plan dependency

The `vercel.json` uses `"*/5 * * * *"` (every 5 minutes). This requires **Vercel Pro or above**.

On Vercel Hobby, change `vercel.json` to:
```json
{ "schedule": "0 0 * * *" }
```

Daily cleanup is acceptable — orphaned auth rows cannot log in and do not block any user-facing operation until the email is re-invited.

### pg_cron Dashboard step

Before applying migration 20260819000002 in production:
1. Open Supabase Dashboard → Database → Extensions.
2. Enable "pg_cron".
3. Then run the migration.

---

## Known Limitations

1. **Soft-delete ban failure is silent to the user.** If `auth.admin.banUser` fails after the RPC succeeds, the action returns success (the deletion was scheduled) but the user may still be able to log in until their JWT refreshes. The failure is logged server-side.

2. **Hard-delete: orphaned auth.users row if `deleteUser` fails.** The profile row is gone, but the auth.users row persists. The auth-sweep cron cleans this up. The email cannot be re-invited until the sweep runs (or it is manually deleted from the Supabase Dashboard).

3. **`undoScheduledDeletion` unban failure is silent to the user.** If `auth.admin.updateUserById({ ban_duration: 'none' })` fails after the RPC clears `deletion_scheduled_at`, the deletion is cancelled in the DB but the user's Auth account is still banned. Logged server-side; requires manual unban via Dashboard.

4. **Audit log failure is silent to the user.** If a log write fails, the primary operation is still considered successful. The failure is logged via `console.error` on the server. Ops should monitor these log lines.

5. **Audit log backfill gap.** The log is accurate only from the point migration 20260819000002 goes live. Pre-existing lifecycle events (invites sent before this migration, deactivations, etc.) are not in the log.

---

## Assumptions

1. All authorization checks are enforced in the Server Action itself (not relying on RPC guards, which use `auth.uid()` that returns NULL under service-role — reviewer finding SF-1).
2. The `profiles.id = auth.users.id` invariant holds for all users (established at invite time and signup time). The ban/deleteUser calls use `targetProfileId` as the auth user ID.
3. The `employee_directory` view does not need changes — it correctly excludes employees with `deletionScheduledAt !== null` because they have `status = 'active'` (the CHECK constraint), but the ban means their JWT won't validate. Including them in the directory is acceptable for this PRD's scope.

---

## Next Steps

1. **Frontend engineer:** build the 5 new mutation hooks + UI (row action menu, confirmation dialogs, status badge).
2. **Deploy:** apply migrations in the correct order, set `CRON_SECRET` in Vercel, enable pg_cron in Supabase Dashboard.
3. **Ops:** after first deploy, run smoke tests from the DB handoff doc and verify the pg_cron job is registered.
4. **Future:** audit log UI (query key factory is pre-defined; the `employee_lifecycle_log` table is ready).
