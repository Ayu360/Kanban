# Employee Lifecycle — Deletion & Invite Management PRD

---

# Overview

This module extends the Employees module (03-employees.md) with terminal lifecycle operations that do not exist today: permanent employee deletion (hard and soft), cancellation of pending invitations, and resending invitations. It also introduces a structured audit log for all lifecycle events.

Deactivation and reactivation (already shipped in 03-employees.md) are unchanged by this PRD. Deletion is a distinct, irreversible operation that goes beyond deactivation: it removes the employee's profile and auth identity from the system entirely, leaving controlled tombstone references in downstream data rather than cascading data loss.

This module depends on the Employees module being complete and in production. It must not be implemented until 03-employees.md is fully merged and stable.

---

# Goals

1. Company admins can permanently delete an employee's account — either immediately (hard delete) or with a 24-hour reversible grace period (soft delete).
2. Company admins can cancel a pending invitation, freeing the invited email address for re-use.
3. Company admins can resend a pending invitation, refreshing the invite token without creating a duplicate profile.
4. Every lifecycle event — including invite cancellations — is written to an append-only audit log.
5. Downstream data (team memberships, boards) is preserved as tombstones after deletion so admins can clean up manually rather than facing silent data loss.
6. Platform admins can delete employees in any company. Platform admins cannot be deleted by anyone.

---

# Non-Goals

- Blacklisting email addresses to permanently bar re-invitation (user-requested; deferred to post-MVP).
- Bulk deletion or multi-row selection workflows.
- Throttling or rate-limiting deletion operations.
- Task and comment cascade behaviour on deletion — deferred to the Tasks module PRD, which must implement the tombstone pattern consistently.
- Data export before deletion (GDPR right to portability) — post-MVP.
- Reason or justification capture on deletion — post-MVP.
- Platform admin deletion via the customer-facing UI — consistent with 03-employees.md non-goal; platform admins are managed only at the database bootstrap level.

---

# User Stories

1. As a company admin, I can permanently delete an employee so that their account and auth identity are removed from the system.
2. As a company admin, I can choose a 24-hour soft-delete grace period so that I can reverse the deletion if I made a mistake before the account is permanently destroyed.
3. As a company admin, I can cancel a scheduled deletion while the grace period is active so that the employee's account is fully restored.
4. As a company admin, I can cancel a pending invitation so that the invited email slot is freed and the profile row is removed.
5. As a company admin, I can resend a pending invitation so that the invitee gets a fresh invite link without creating a duplicate account.
6. As a company admin, I am prevented from deleting myself unless another active admin exists in my company.
7. As a platform admin, I can delete an employee in any company without the same-company restriction.
8. As a platform admin, I cannot be deleted by anyone, including myself.
9. As any admin, I can view an audit log of all lifecycle events (invites, deletions, role changes, deactivations) for employees in my company.

---

# Functional Requirements

## FR-01: Hard Delete

A company admin can initiate an immediate, irreversible deletion of an employee's profile. The action deletes the `profiles` row and the corresponding `auth.users` row via the Supabase Auth admin API. There is no recovery path after a hard delete completes.

## FR-02: Soft Delete (Grace Period)

A company admin can initiate a soft delete, which sets `profiles.deletion_scheduled_at = now() + interval '24 hours'` and begins the grace window. The profile remains in the system during the grace period. Login access is revoked immediately upon soft-delete initiation (RD-02) — the Server Action calls `auth.admin.banUser` after the RPC succeeds, mirroring the deactivation pattern.

## FR-03: Grace Period Visibility

During the 24-hour grace window, the employee's row in the admin employee list displays a "Deletion Scheduled" status indicator and the scheduled deletion timestamp. All management actions except "Cancel Scheduled Deletion" are disabled for that row.

## FR-04: Cancel Scheduled Deletion

A company admin can cancel a soft-delete during the grace window. Cancellation clears `deletion_scheduled_at` and restores the employee's access via `auth.admin.updateUserById({ ban_duration: 'none' })` (RD-02). The employee row returns to `status = 'active'` — per RD-01, only active profiles could have been soft-deleted, so there is no ambiguity about the restored status.

## FR-05: Scheduled Deletion Promotion

After the 24-hour grace window expires, the profile is promoted to a hard delete via a pg_cron job (RD-05 confirms pg_cron is available on the Supabase plan). The cron job runs `_promote_scheduled_deletions()` every 5 minutes; that internal function iterates profiles where `deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at < now()` and deletes them. See RD-05 for the full migration spec and the auth-sweep companion requirement.

## FR-06: Two Deletion Entry Points

The admin employee list row actions menu offers two distinct deletion options: "Delete Now" (hard delete, immediate) and "Schedule Deletion" (soft delete, 24-hour grace). Both options are absent on the admin's own row when they would violate the last-admin invariant. Both options are absent on platform admin rows.

## FR-07: Platform Admin Protection

The hard-delete and soft-delete RPCs explicitly check `profiles.is_platform_admin` on the target row. If the target is a platform admin, the RPC raises `platform_admin_protected` and the Server Action surfaces the error to the UI. This check is enforced at the database layer; UI hiding is UX only.

## FR-08: Self-Delete Allowed With Quorum

A company admin may delete themselves only if at least one other active, non-platform-admin company admin exists. The RPC reuses the same last-admin lockout count already established in `deactivate_employee` and `change_employee_role`: count of profiles in the company with `role = 'admin'` and `status != 'deactivated'`, excluding the target. If the count is zero, the RPC raises `last_admin_lockout` and the Server Action returns the error: "You must promote another admin before deleting your own account."

## FR-09: Cancel Invitation

A company admin can cancel a pending invitation from the pending employee row's action menu. Cancellation deletes the `profiles` row and the corresponding `auth.users` row via `auth.admin.deleteUser`. The invited email address is freed for future re-invitation. Cancellation is logged to `employee_lifecycle_log` with `action = 'invite_cancelled'`.

## FR-10: Resend Invitation

A company admin can resend an invitation to a pending employee. Resend calls `auth.admin.inviteUserByEmail` for the same email address. Supabase's invite API refreshes the token on a subsequent invite call, so the profile row is reused without modification. The action is logged with `action = 'invite_resent'`.

## FR-11: Resend on Accepted Invitation

Resend is available only on profiles with `status = 'pending'`. If a profile has transitioned to `status = 'active'` by the time the resend action fires, the Server Action returns an error: "This employee has already accepted their invitation." No new invite email is sent.

## FR-12: Audit Log — All Lifecycle Events

Every lifecycle operation below writes a row to `public.employee_lifecycle_log`. The log is append-only. No application-layer path permits UPDATE or DELETE on this table.

Logged events:
- `invite_sent` — initial invitation sent (backfill from existing `inviteEmployeeAction`; the existing action should be extended to write this log entry)
- `invite_cancelled` — pending invitation cancelled by admin
- `invite_resent` — invitation resent by admin
- `invite_accepted` — invited user completed onboarding (written by the `activate_invited_employee` RPC path or the accept-invite Server Action)
- `role_changed` — role promoted or demoted (existing `changeRoleAction` should be extended)
- `deactivated` — employee deactivated (existing `deactivateEmployeeAction` should be extended)
- `reactivated` — employee reactivated (existing `reactivateEmployeeAction` should be extended)
- `soft_deleted` — soft-delete initiated
- `hard_deleted` — hard delete executed (whether directly or promoted from soft-delete)
- `deletion_undone` — scheduled deletion cancelled during grace window

## FR-13: Audit Log Read Access

Company admins can read log entries scoped to their own company (via `target_company_id` on the log row). Platform admins can read all log entries. Regular employees have no access to the audit log.

## FR-14: Soft Delete Transition Guard

A soft-delete operation is only permitted on profiles with `status = 'active'` (RD-01). A deactivated profile must be reactivated before it can be soft-deleted. The `soft_delete_employee` RPC raises `invalid_state_for_soft_delete` if the target profile is not `status = 'active'`. Hard delete of a deactivated profile is permitted (no guard blocks it).

## FR-15: Tombstone — Team Memberships

When an employee is deleted (hard or soft-promoted-to-hard), their `team_members` rows are NOT deleted. They persist as tombstones with `profile_id = NULL` (after the FK change described in the Data Model section). The Teams UI must render a `NULL` `profile_id` as `[Deleted User]`. Admin must manually remove the tombstone rows. This is an intentional departure from the current `ON DELETE CASCADE` behaviour and requires a coordinated schema change to the `team_members` table.

## FR-16: Tombstone — Boards

When an employee is deleted, boards they created are kept as tombstones. No ownership transfer is performed automatically. Admin must reassign or delete them manually. Per RD-04, personal-board auto-deletion is deferred; ALL boards created by the deleted user become tombstones in MVP regardless of team-membership shape. If the `boards` table has a `created_by` FK referencing `profiles.id`, that FK is altered to `ON DELETE SET NULL` in the same migration (see RD-04 for the audit note).

## FR-17: Tombstone — Tasks and Comments

Tasks and comments are out of scope for this PRD. The tombstone pattern established here (preserve data, nullify FK, render `[Deleted User]`) is the authoritative model that the Tasks module must implement consistently when it ships.

## FR-18: Auth Identity Deletion Sequencing

For both hard delete and the promotion of a soft delete, the sequence is: (1) write the `hard_deleted` log entry, (2) delete the `profiles` row, (3) call `auth.admin.deleteUser` to remove the `auth.users` row. Step (3) is the trailing side effect; the DB row deletion is the authoritative action. If step (3) fails (e.g., transient Supabase Auth API error), the Server Action must surface the failure and must not leave the system in a silent half-deleted state. An appropriate retry mechanism or manual remediation note should be documented in the handoff.

## FR-19: Pending Profile — No Deactivate Path

Consistent with guard `G_H1` in the existing `deactivate_employee` RPC, a pending profile cannot be deactivated. The same restriction applies to deletion: a pending profile should be cancelled via FR-09 (Cancel Invitation), not deleted via the employee deletion flow. The deletion RPCs raise `cannot_delete_pending: cancel the invitation instead` if the target has `status = 'pending'`.

## FR-20: Confirmation Dialog

All four terminal actions (hard delete, soft delete, cancel invite, resend invite) require a confirmation dialog before execution. The dialog uses the existing `EmployeeConfirmDialog` with `variant='destructive'` for hard delete, soft delete, and cancel invite. Resend invite uses `variant='default'`. No email-typing challenge is required. Destructive dialogs display the employee's name and email in the confirmation copy to reduce accidental mis-targeting.

---

# Business Rules

- Hard delete is irreversible. No undo path exists once the `profiles` row and `auth.users` row are deleted.
- Soft delete provides a 24-hour grace window. After the window, the deletion is equivalent to a hard delete.
- Deactivation (03-employees.md) is not affected by this PRD and remains a non-terminal, reversible operation.
- Platform admins (`is_platform_admin = true`) cannot be deleted by any operation exposed through this module. This is enforced at the DB layer.
- The last active admin in a company cannot be deleted (same invariant as deactivation and demotion lockouts already in place).
- Tombstone rows in `team_members` (where `profile_id IS NULL`) are not cleaned up automatically. Admin bears responsibility for manual cleanup.
- The audit log is write-only from the application layer. No application-layer mutation path permits UPDATE or DELETE on `employee_lifecycle_log` rows. Service-role retains full access for future retention-sweep migrations if needed.
- Extending existing actions (`inviteEmployeeAction`, `changeRoleAction`, `deactivateEmployeeAction`, `reactivateEmployeeAction`) to write audit log entries is in scope for this PRD. Those actions are already server-side and already use the service-role client; adding a log INSERT is a low-risk extension.

---

# Edge Cases

**EC-01: Admin deletes an employee who is currently logged in.** The hard-delete RPC deletes the `profiles` row. If login-access revocation is implemented (via `auth.admin.banUser` before `auth.admin.deleteUser`), the session is terminated on next refresh. If not, the deleted user's session will fail on the next JWT refresh when Supabase can no longer find the `auth.users` row. Either path results in the user being logged out within one JWT TTL (~1 hour default). Document this as accepted behaviour in the handoff.

**EC-02: Admin cancels a soft delete while the employee is logged in and was not access-revoked.** The cancellation clears `deletion_scheduled_at` transparently. No session interruption occurs.

**EC-03: Admin cancels a soft delete while the employee was access-revoked at soft-delete time.** Cancellation must also call `auth.admin.updateUserById({ ban_duration: 'none' })` to restore access, mirroring the reactivation flow. The `cancel_scheduled_deletion` Server Action orchestrates both the DB update and the Auth unban.

**EC-04: Soft delete grace period expires while the admin is viewing the employee list.** The lazy-check fallback (if used) promotes the profile on the next admin list load. The pg_cron path promotes it in the background. Either way, the admin UI should re-fetch the employee list at reasonable intervals and reflect the updated status without requiring a manual page refresh.

**EC-05: Admin resends an invitation but the invite token has already been accepted.** FR-11 handles this: the Server Action detects `status = 'active'` and returns an error without calling the Supabase Auth API.

**EC-06: Hard delete is attempted on a profile that is in soft-delete grace window.** The `hard_delete_employee` RPC accepts this as a valid operation: it treats the grace window as abandoned, performs the immediate hard delete, and writes a `hard_deleted` log entry. The scheduled soft-delete row (if tracked separately) is consumed.

**EC-07: Pg_cron job fires while an admin is simultaneously cancelling the scheduled deletion.** The RPC for `cancel_scheduled_deletion` and the pg_cron-triggered `hard_delete_employee` must use a transaction-level check on `deletion_scheduled_at` to avoid a race. The `hard_delete_employee` RPC should check that `deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at < now()` before proceeding. If `deletion_scheduled_at` has already been cleared (by the concurrent cancel), the RPC returns a no-op. This is a critical concurrency edge case and must be flagged in the DB agent handoff.

**EC-08: Cancel invitation fails at the `auth.admin.deleteUser` step.** The `profiles` row must not be deleted if the auth row deletion fails, to avoid orphaned auth users. The Server Action must attempt `auth.admin.deleteUser` first, and only delete the `profiles` row on success.

**EC-09: Company admin attempts to delete a platform admin.** FR-07 guard fires at the DB layer. Error copy: "Platform admin accounts cannot be deleted."

**EC-10: Soft-delete column CHECK constraint.** The `deletion_scheduled_at` column is `TIMESTAMPTZ NULL`; only soft-deletes write a value. The CHECK constraint (`deletion_scheduled_at IS NULL OR status = 'active'`) means a deactivated profile cannot be soft-deleted without first being reactivated (RD-01, confirmed). Hard delete of a deactivated profile remains permitted.

---

# Data Model

Described in prose only. SQL lives in `supabase/migrations/`.

## New Column: `profiles.deletion_scheduled_at`

Add `deletion_scheduled_at TIMESTAMPTZ NULL` to `public.profiles`.

- `NULL` means no scheduled deletion is pending.
- A non-null value means the profile is in the soft-delete grace window. The value is the timestamp at which the grace period expires and the hard delete fires.
- CHECK constraint (RD-01, confirmed): `(deletion_scheduled_at IS NULL) OR (status = 'active')`. Soft-delete is only permitted on active profiles. Deactivated profiles must be reactivated first before soft-delete is allowed.
- The `deletion_scheduled_at` constraint interacts with the existing `deactivated_at` constraint. The DB agent must verify that the two constraints do not conflict for any reachable status value.
- This column is never written directly by an authenticated client session. Only SECURITY DEFINER RPCs and service-role Server Actions write it.

## New Table: `public.employee_lifecycle_log`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID NOT NULL DEFAULT gen_random_uuid()` | Primary key |
| `actor_profile_id` | `UUID NULL` | Profile ID of the admin who performed the action. `NULL` if the actor's profile was itself deleted before log retention. |
| `target_profile_id` | `UUID NULL` | Profile ID of the affected employee. `NULL` after hard deletion if the FK is nullified (see FK note below). |
| `target_email` | `TEXT NOT NULL` | Email captured at action time. Preserved for post-deletion queryability even when `target_profile_id` becomes `NULL`. |
| `target_company_id` | `UUID NOT NULL` | Company of the affected employee, captured at action time. Required for RLS scoping after the profile row is gone. |
| `action` | `TEXT NOT NULL` | One of: `invite_sent`, `invite_cancelled`, `invite_resent`, `invite_accepted`, `role_changed`, `deactivated`, `reactivated`, `soft_deleted`, `hard_deleted`, `deletion_undone`. Enforced by a `CHECK` constraint. |
| `metadata` | `JSONB NULL` | Extra context. Examples: `{ "old_role": "employee", "new_role": "admin" }` for `role_changed`; `{ "scheduled_at": "<timestamp>" }` for `soft_deleted`. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Append time. Never updated. |

The `actor_profile_id` and `target_profile_id` columns reference `profiles.id` with `ON DELETE SET NULL` to preserve log rows after profile deletion. This is consistent with the tombstone philosophy: log history must survive user deletion.

The log table must have RLS enabled. INSERT is permitted only from service-role (the Server Actions write log entries via the service-role client). SELECT is permitted for company admins scoped to their `target_company_id`, and for platform admins across all rows.

Because `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role` is now in place (migration `20260818000001`), future tables including this one will receive automatic service-role grants at creation time. The DB agent should confirm this applies and does not require a manual grant.

## FK Behaviour Change: `team_members.profile_id` — CASCADE to SET NULL

**This is the most impactful cross-module data model change in this PRD. It must not be applied silently.**

Current state (in `20260809000001_teams_schema.sql`):

```
CONSTRAINT team_members_profile_id_fkey
  FOREIGN KEY (profile_id)
  REFERENCES public.profiles (id)
  ON DELETE CASCADE
```

Required change: alter this FK to `ON DELETE SET NULL`. When a profile is deleted, the `team_members.profile_id` is set to `NULL` rather than the row being deleted. This preserves the team membership slot as a tombstone, per FR-15.

Consequences of this change that the DB agent and Teams frontend must handle:

1. `team_members.profile_id` must become `NULL`-able. Today it is `NOT NULL` (implied by the composite PK `(team_id, profile_id)`). Allowing `NULL` in one column of a composite primary key is not valid in PostgreSQL — a `NULL` value cannot be part of a primary key. Per RD-03 the composite PK is replaced by a surrogate `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, and `(team_id, profile_id)` is demoted to a `UNIQUE` constraint with `NULLS NOT DISTINCT`. This restructure must happen in the same migration as the FK alteration; it cannot be split across releases.

2. The `check_team_member_company_match` trigger currently reads `profiles.company_id` for `NEW.profile_id`. If `profile_id` can now be `NULL`, the trigger must handle the `NULL` case (skip the company-match check for tombstone inserts, which should not occur via normal application paths).

3. RLS on `team_members` — the `team_members_select_member` and `team_members_insert_company_admin` policies reference `team_members.profile_id` in EXISTS subqueries (`tm_self.profile_id = auth.uid()`). A `NULL` `profile_id` row will never match `auth.uid()`, which is the correct tombstone behaviour — deleted users do not gain access. No RLS policy change is strictly necessary, but the Teams agent must verify that `NULL` profile_id rows do not cause unexpected filter failures.

4. The `idx_team_members_profile_id_team_id` index has `profile_id` as the leading column. Null values in an indexed column are stored in the index in PostgreSQL but are not matched by equality predicates (`= auth.uid()`). Index behaviour is correct for the tombstone pattern; no index change required.

5. The Teams frontend must render tombstone rows. Any team member display that renders a profile by `profile_id` must handle `NULL` gracefully and show `[Deleted User]` in place of a name and avatar.

---

# API Surface

## New Server Actions

All new Server Actions are added to `src/features/employees/services/employeesActions.ts` (or a new file `src/features/employees/services/employeesLifecycleActions.ts` if file length warrants separation). All use the service-role client. All are `'use server'`.

### `softDeleteEmployeeAction(targetProfileId: string)`

- Validates caller is admin or platform admin.
- Calls `soft_delete_employee(targetProfileId)` RPC.
- On RPC success: calls `auth.admin.banUser(targetProfileId)` to revoke login access immediately (RD-02).
- Returns `{ success: true }` or a typed error.
- Invalidates `['employees']` TanStack Query key.

### `hardDeleteEmployeeAction(targetProfileId: string)`

- Validates caller is admin or platform admin.
- Calls `hard_delete_employee(targetProfileId)` RPC (writes log, deletes profile row).
- Calls `auth.admin.deleteUser(targetProfileId)` to remove the auth identity.
- Returns `{ success: true }` or a typed error.
- Invalidates `['employees']` TanStack Query key.

### `undoScheduledDeletionAction(targetProfileId: string)`

- Validates caller is admin or platform admin.
- Calls `cancel_scheduled_deletion(targetProfileId)` RPC.
- On RPC success: calls `auth.admin.updateUserById({ ban_duration: 'none' })` to restore login access (RD-02).
- Returns `{ success: true }` or a typed error.
- Invalidates `['employees']` TanStack Query key.

### `cancelInviteAction(targetProfileId: string)`

- Validates caller is admin or platform admin.
- Validates target has `status = 'pending'`.
- Calls `auth.admin.deleteUser(targetProfileId)` first (EC-08 sequencing).
- On auth deletion success: deletes the `profiles` row via the service-role client.
- Writes `invite_cancelled` log entry.
- Returns `{ success: true }` or a typed error.
- Invalidates `['employees']` TanStack Query key.

### `resendInviteAction(targetProfileId: string, email: string)`

- Validates caller is admin or platform admin.
- Validates target has `status = 'pending'` (FR-11).
- Calls `auth.admin.inviteUserByEmail(email)` to refresh the invite token.
- Writes `invite_resent` log entry.
- Returns `{ success: true }` or a typed error.

## New RPCs

All new RPCs are SECURITY DEFINER, callable by service-role only (REVOKE from PUBLIC, GRANT to service_role), following the same pattern as `deactivate_employee` and `change_employee_role`.

### `soft_delete_employee(p_target_profile_id uuid) RETURNS jsonb`

Guards:
- G1: Caller must be company admin or platform admin.
- G2: For non-platform admins, target must be in the same company.
- G3: If caller is deleting themselves, another active admin must exist (last-admin lockout).
- G7: Platform admin target is blocked (`platform_admin_protected`).
- G14: Target status must be `'active'` (RD-01; raises `invalid_state_for_soft_delete` otherwise).

Writes: sets `deletion_scheduled_at = now() + interval '24 hours'` on the target profile. Inserts `soft_deleted` row into `employee_lifecycle_log`.

Returns: `{ "success": true, "deletion_scheduled_at": "<timestamp>" }` or raises a named exception.

### `hard_delete_employee(p_target_profile_id uuid) RETURNS jsonb`

Guards: same as `soft_delete_employee` (G1, G2, G3, G7).

Additional guard: G15: target `status != 'pending'` — pending profiles must be cancelled via invite cancellation flow, not deleted (FR-19).

For pg_cron-triggered calls (where the caller is `postgres` rather than a user session): the RPC must also work when called by the cron job without a live auth session. This may require the pg_cron job to use a privileged role rather than relying on `auth.uid()`. The DB agent must spec the exact invocation pattern for the cron path and ensure guard evaluation remains correct.

Writes: inserts `hard_deleted` row into `employee_lifecycle_log`, then deletes the `profiles` row. The auth.users row deletion is handled by the Server Action after this RPC returns (same DB-first pattern as `deactivate_employee`).

Returns: `{ "success": true }` or raises a named exception.

### `cancel_scheduled_deletion(p_target_profile_id uuid) RETURNS jsonb`

Guards: G1, G2.

Additional guard: G16: target must have `deletion_scheduled_at IS NOT NULL`. If already NULL, returns a no-op.

Concurrency guard: uses the existing `deletion_scheduled_at` value as an optimistic lock — clears it atomically and returns whether the row was actually updated (affected row count = 0 means the cron job won already; return `{ "success": false, "reason": "already_deleted" }`).

Writes: sets `deletion_scheduled_at = NULL` on the target profile, restores `status` to its pre-soft-delete value (the RPC must know what that value was — either store it in `metadata` at soft-delete time or read the current `deletion_scheduled_at` state and infer). Inserts `deletion_undone` row into `employee_lifecycle_log`.

Returns: `{ "success": true, "noop": false }` or `{ "success": false, "reason": "already_deleted" }`.

## Existing Server Action Extensions

The following existing actions must be extended to write audit log entries. No functional behaviour changes — the log write is additive.

- `inviteEmployeeAction`: write `invite_sent` entry.
- `changeRoleAction`: write `role_changed` entry with `metadata: { old_role, new_role }`.
- `deactivateEmployeeAction`: write `deactivated` entry.
- `reactivateEmployeeAction`: write `reactivated` entry.
- Accept-invite path (Server Action or `activate_invited_employee` RPC): write `invite_accepted` entry.

---

# RLS and Authorization Matrix

| Operation | Regular Employee | Company Admin | Platform Admin |
|---|---|---|---|
| Read audit log | Denied | Own company rows only | All rows |
| Soft-delete employee | Denied | Own company, not self if last admin, not platform admin | Any company, not platform admin |
| Hard-delete employee | Denied | Own company, not self if last admin, not platform admin | Any company, not platform admin |
| Cancel scheduled deletion | Denied | Own company | Any company |
| Cancel invite | Denied | Own company | Any company |
| Resend invite | Denied | Own company | Any company |
| Delete platform admin | Denied | Denied | Denied (at DB layer) |

RLS on `employee_lifecycle_log`:
- SELECT: company admin — `target_company_id = jwt.company_id AND jwt.role = 'admin'`; platform admin — `jwt.is_platform_admin = true`.
- INSERT: service_role only (no authenticated INSERT policy).
- UPDATE: no policy (append-only).
- DELETE: no policy (append-only; service_role retains physical access for future retention migrations).

All business authorization logic for deletion RPCs is enforced in the SECURITY DEFINER function bodies (same pattern as existing RPCs). Frontend role-checks (hiding the delete menu items) are UX only and must not be relied upon for security.

---

# Cascade and Tombstone Behaviour

## Profiles Row

On hard delete: the `profiles` row is deleted. FKs on other tables that reference `profiles.id` with `ON DELETE SET NULL` (after the FK migration) produce NULL in the referencing column. FKs with `ON DELETE RESTRICT` will block deletion if unremediated — the DB agent must audit all tables for `profiles.id` FK references before implementing.

## team_members

`team_members.profile_id` FK changes from `ON DELETE CASCADE` to `ON DELETE SET NULL`. The membership row persists with `profile_id = NULL`. The admin sees the tombstone row and must manually remove it. The Teams UI renders NULL profile_id as `[Deleted User]`. This is the highest-impact schema change in this PRD and is flagged as requiring cross-module coordination (see Migration Considerations).

## boards

Per RD-04, all boards created by the deleted user become tombstones. If the `boards` table has a `created_by` FK referencing `profiles.id` (DB agent must audit and confirm during implementation), that FK is altered to `ON DELETE SET NULL` in the same migration. Admin must manually reassign or archive tombstoned boards. Personal-board auto-deletion is filed as a follow-up feature after the Tasks module ships.

## Future Tables (Tasks, Comments, Activity)

The tombstone pattern for this module is: preserve the data row, set the `profile_id`-referencing FK to NULL via `ON DELETE SET NULL`, render `[Deleted User]` in the UI. All future modules that reference `profiles.id` must adopt this same pattern. The Tasks module PRD must reference this section when specifying its own FK and deletion behaviour.

---

# UX Specification

## Employee List Row — Action Menu Changes

The existing kebab/actions menu on each employee row gains the following items:

**For active employees:**
- (existing) Promote to Admin / Demote to Employee
- (existing) Deactivate
- (new) Schedule Deletion — opens soft-delete confirmation dialog
- (new) Delete Now — opens hard-delete confirmation dialog

**For pending employees (status = 'pending'):**
- (new) Cancel Invite — opens cancel-invite confirmation dialog
- (new) Resend Invite — opens resend-invite confirmation dialog
- (remove) Promote / Demote / Deactivate actions — not applicable to pending profiles

**For employees in soft-delete grace window:**
- (new) Cancel Scheduled Deletion — only action available; opens undo confirmation dialog
- All other actions disabled

**For the admin's own row:**
- Delete options are absent unless another active admin exists. If no quorum exists, the items are hidden (not disabled) to avoid surfacing a dead-end path.

**For platform admin rows (visible only to platform admins):**
- Delete options are absent entirely. No confirmation dialog is ever shown.

## Confirmation Dialogs

All confirmation dialogs use the existing `EmployeeConfirmDialog` component pattern.

**Hard Delete dialog:**
- Title: "Permanently Delete Employee"
- Body: "This will permanently remove [name] ([email]) from the system. Their team memberships will be preserved for you to clean up manually. This action cannot be undone."
- Confirm button: "Delete Permanently" — `variant='destructive'`
- Cancel button: "Cancel"

**Soft Delete (Schedule Deletion) dialog:**
- Title: "Schedule Deletion"
- Body: "This will schedule [name] ([email]) for permanent deletion in 24 hours. Their access will be revoked immediately. You can cancel the deletion during this 24-hour window."
- Confirm button: "Schedule Deletion" — `variant='destructive'`
- Cancel button: "Cancel"

**Cancel Scheduled Deletion dialog:**
- Title: "Cancel Scheduled Deletion"
- Body: "This will cancel the scheduled deletion for [name] ([email]) and restore their access."
- Confirm button: "Cancel Deletion" — `variant='default'`
- Cancel button: "Dismiss"

**Cancel Invite dialog:**
- Title: "Cancel Invitation"
- Body: "This will cancel the pending invitation for [email] and remove their account. They will no longer be able to use the invite link."
- Confirm button: "Cancel Invitation" — `variant='destructive'`
- Cancel button: "Keep Invitation"

**Resend Invite dialog:**
- Title: "Resend Invitation"
- Body: "This will send a fresh invitation to [email]. The previous invite link will no longer work."
- Confirm button: "Resend" — `variant='default'`
- Cancel button: "Cancel"

## Status Badge — "Deletion Scheduled"

Add a new status badge variant for profiles in the soft-delete grace window. Suggested label: "Deletion Scheduled" with an amber/warning color, and a tooltip showing the scheduled deletion timestamp. This badge appears in the admin employee list alongside the existing Active / Pending / Deactivated badges.

## Error Copy Mapping

| RPC error code | User-visible message |
|---|---|
| `permission_denied` | "You do not have permission to perform this action." |
| `last_admin_lockout` | "You must promote another admin before deleting your own account." |
| `platform_admin_protected` | "Platform admin accounts cannot be deleted." |
| `cannot_delete_pending` | "This invitation must be cancelled, not deleted. Use 'Cancel Invite' instead." |
| `invalid_state_for_soft_delete` | "Only active employees can be scheduled for deletion." |
| `already_deleted` (cancel race) | "This account has already been deleted and cannot be restored." |
| `target_not_found` | "Employee not found. The page may be out of date — please refresh." |
| Generic / unexpected | "Something went wrong. Please try again or contact support." |

## Accessibility

All confirmation dialogs must be focus-trapped modals with `role="dialog"` and `aria-labelledby` pointing to the dialog title. The destructive confirm button must not receive initial focus (to prevent accidental keyboard confirmation). Cancel button receives initial focus. Keyboard: `Escape` dismisses the dialog without action.

---

# Migration Considerations

## New Migration File

This PRD requires a new migration file, suggested name: `20260819000001_employee_lifecycle_deletion.sql` (adjust date prefix to actual implementation date).

## team_members FK Alteration — Breaking Schema Change

The change from `ON DELETE CASCADE` to `ON DELETE SET NULL` on `team_members.profile_id` is the highest-risk change in this migration. Per RD-03 the exact sequence is:

1. Add `team_members.id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
2. Drop the current composite PK `(team_id, profile_id)` and recreate it as a `UNIQUE` constraint with `NULLS NOT DISTINCT`.
3. Alter `team_members.profile_id` to allow `NULL`.
4. Drop the existing FK `team_members_profile_id_fkey` and recreate it with `ON DELETE SET NULL`.
5. Update the `check_team_member_company_match` trigger to short-circuit when `NEW.profile_id IS NULL`.
6. Audit the Teams frontend and repository for queries that assume the composite PK — most filter by `team_id` and select by `profile_id` which continues to work; queries that build cache keys from the composite must switch to the surrogate `id`.

This restructure is signed off (RD-03) and must ship in one atomic migration alongside the deletion RPCs — without it, hard delete of a team member cascades their membership rows, destroying the tombstone data.

## profiles Column Additions

The `deletion_scheduled_at` column and its CHECK constraint are additive (non-breaking). They can be applied in the same migration as the lifecycle RPCs.

## New employee_lifecycle_log Table

New table, no dependencies on existing data. Straightforward addition. Existing actions that should write to it (invite, role change, deactivate, reactivate) will need the log write added; these are in the application layer (Server Actions), not the migration.

## pg_cron Extension

Per RD-05, pg_cron is confirmed available on the Supabase plan and will be enabled by this migration. The migration runs `CREATE EXTENSION IF NOT EXISTS pg_cron;` before scheduling any jobs. If the Supabase project configuration also requires enabling the extension via Dashboard > Database > Extensions, the deploy runbook must include that manual step. The DB agent should verify the extension is active in staging before promoting to production.

The cron job (`promote-scheduled-deletions`) runs every 5 minutes and invokes `public._promote_scheduled_deletions()`. See RD-05 for the full specification, including the `_promote_scheduled_deletions()` internal function requirements and the auth-sweep companion (Edge Function or Vercel job) that removes orphaned `auth.users` rows.

## Grants

New RPCs created by this migration follow the existing pattern (`REVOKE ALL FROM PUBLIC, GRANT TO service_role`). The `employee_lifecycle_log` table will receive automatic service-role grants via the `ALTER DEFAULT PRIVILEGES` set in `20260818000001`. The migration should explicitly grant SELECT to `authenticated` for RLS-governed reads (consistent with the pattern on other tables) and rely on RLS policies to restrict rows.

## Interaction With Existing Constraints

The `profiles_deactivated_at_status_check` constraint (`status = 'deactivated' <=> deactivated_at IS NOT NULL`) must remain intact. The new `deletion_scheduled_at` column and its constraint must be verified to not conflict with it for any reachable status value. Specifically: a profile that is soft-deleted (has `deletion_scheduled_at` set) must have `status = 'active'` per the proposed CHECK constraint, which means `deactivated_at` must be NULL — consistent with the existing constraint.

---

# Risks and Resolved Decisions

## Resolved Decisions

All five open questions from the initial draft have been resolved by the user. The resolutions are recorded here to preserve the reasoning trail for the DB agent and future readers.

**RD-01 (was OQ-01): Soft-delete of a deactivated profile — BLOCKED.**

A deactivated profile must be reactivated before it can be soft-deleted. Hard delete of a deactivated profile is permitted. Rationale: keeps the status machine simple (each terminal transition has one legal entry state). The proposed CHECK constraint `(deletion_scheduled_at IS NULL) OR (status = 'active')` is confirmed. The DB agent should implement this constraint and the `soft_delete_employee` RPC guard G14 (raises `invalid_state_for_soft_delete`) as specified.

**RD-02 (was OQ-02): Login access is revoked immediately upon soft-delete initiation.**

Mirrors the deactivation pattern. On soft-delete: the `softDeleteEmployeeAction` calls `auth.admin.banUser(targetProfileId)` after the RPC succeeds. On `undoScheduledDeletionAction`: unbans via `auth.admin.updateUserById({ ban_duration: 'none' })`. This affects the dialog copy (Schedule Deletion and Cancel Scheduled Deletion dialogs must include the access-revocation and access-restoration language shown in the UX spec). EC-03 sequencing is confirmed authoritative.

**RD-03 (was OQ-03): team_members PK is restructured to a surrogate UUID PK.**

Approved approach:
- Add `team_members.id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- Demote `(team_id, profile_id)` to a `UNIQUE` constraint with `NULLS NOT DISTINCT` so tombstones do not collide with themselves.
- `team_members.profile_id` becomes `NULL`-able.
- Alter the FK `team_members_profile_id_fkey` to `ON DELETE SET NULL`.
- Update the `check_team_member_company_match` trigger to short-circuit and return `NEW` when `NEW.profile_id IS NULL` (tombstone rows bypass the company-match check).

Downstream impact:
- `SupabaseTeamsRepository` and any Teams module query that keys or joins by `(team_id, profile_id)` must be audited. Most queries filter by `team_id` and select by `profile_id` for the current session, which continues to work. Queries that build cache keys from the composite must switch to the new surrogate `id`.
- `useTeamMembers` and related hooks must render `[Deleted User]` for `profile_id = NULL` rows.
- No existing data migration is required — no team_members rows have `NULL` profile_id today; the change is forward-compatible.

The DB agent must produce a single migration that performs the PK restructure and FK alteration atomically before creating any deletion RPCs that depend on this behaviour. The migration must not be split across releases.

**RD-04 (was OQ-04): Personal-board detection is DEFERRED. All boards become tombstones in MVP.**

No `is_personal` column added now. All boards created by the deleted user persist as tombstones with `created_by = NULL` after the FK alteration. Admin manually reassigns or archives them. Personal-board auto-deletion is filed as a follow-up feature to be reopened after the Tasks module ships.

The DB agent should NOT add any `is_personal` column and should NOT include any board-deletion logic in the `hard_delete_employee` RPC. If the boards module has a `created_by` FK to `profiles.id`, that FK should be altered to `ON DELETE SET NULL` for consistency with the tombstone philosophy (this is an audit item — the DB agent should confirm the current FK definition on `boards` before altering).

**RD-05 (was OQ-05): pg_cron is CONFIRMED AVAILABLE. Use pg_cron for scheduled deletion promotion.**

User verified via SQL check: `SELECT * FROM pg_available_extensions WHERE name = 'pg_cron'` returned a row (extension is on the allowlist for the Supabase project). `pg_extension` returned no rows — the extension is available but not yet installed.

The migration must:
1. Run `CREATE EXTENSION IF NOT EXISTS pg_cron;` before scheduling any jobs. Supabase installs pg_cron into the `extensions` schema; jobs are scheduled via `cron.schedule()`.
2. Create the `_promote_scheduled_deletions()` internal function (see R-03) that iterates `profiles WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at < now()` and calls the shared hard-delete logic for each. This function must be callable only by service_role / postgres and must NOT be exposed to authenticated users.
3. Schedule the cron job: `SELECT cron.schedule('promote-scheduled-deletions', '*/5 * * * *', $$SELECT public._promote_scheduled_deletions();$$);` (every 5 minutes is sufficient — the grace window is 24 hours, and this bounds the maximum overrun to 5 minutes past the intended deletion time).
4. Verify the cron job appears in `cron.job` after migration.
5. The lazy-check fallback (evaluate on admin list load) is no longer needed and should NOT be implemented.

Note on the auth.users deletion step: pg_cron runs inside PostgreSQL and cannot call the Supabase Auth admin HTTP API. The `_promote_scheduled_deletions()` function deletes the `profiles` row inside the DB; a companion Edge Function or scheduled Vercel job must sweep for orphaned `auth.users` rows (users whose `profiles` row no longer exists) and call `auth.admin.deleteUser` for each. The DB agent must flag this in the handoff so the backend agent implements the auth-sweep companion. Alternative: pg_net (also available on Supabase Pro) could be used to call an internal HTTP endpoint that performs the auth deletion — the DB agent should choose the cleaner option and document it in the handoff.

## Risks

**R-01: team_members PK restructuring is a breaking Teams module change.** Changing the composite PK affects the Teams frontend query layer, repository, and any API contract that returns `team_members` rows keyed by `(team_id, profile_id)`. The Teams agent must be notified and the change must be coordinated, not applied silently.

**R-02: Auth.admin.deleteUser failure leaves orphaned profiles row.** The EC-08 sequencing (auth first, then profiles) mitigates this — but if the profiles delete fails after a successful auth delete, the profile row becomes a zombie with no corresponding auth user. The Server Action must handle this case and either retry the profiles delete or flag for manual remediation. The handoff document must include a remediation query for this scenario.

**R-03: pg_cron job runs with postgres role, bypassing auth.uid() in RPC guards.** The `hard_delete_employee` RPC derives the caller's identity from `auth.uid()`. In a pg_cron context, there is no live user session and `auth.uid()` returns NULL, which will fail the G1 guard. The DB agent must implement a separate internal-facing function (e.g., `_promote_scheduled_deletions()`) that the pg_cron job calls, which skips the auth-session guards but applies its own invariant checks (platform admin protection, etc.). This function must be callable only by service_role or postgres and must NOT be exposed to authenticated users.

**R-04: Audit log backfill for existing events.** Existing lifecycle events (invites, deactivations) that occurred before this migration are not in the audit log. This is an accepted gap for MVP; the log is accurate from the point this migration goes live forward. If retrospective accuracy is needed, a backfill script must be written separately.

**R-05: Supabase Auth API idempotency on re-invite.** Calling `auth.admin.inviteUserByEmail` for an email that already has a pending invite token refreshes the token. Calling it for an email that has already accepted and has an `active` profile will produce a Supabase Auth error. FR-11 guards against this at the application layer, but the error must also be caught and normalized at the repository layer per ADR-0004.

---

# Out of Scope / Future

- **Email blacklisting.** Permanently banning an email from being invited again. User-flagged for post-MVP.
- **Bulk deletion.** Multi-row selection and bulk terminal operations. Explicitly out of scope per user input.
- **Task and comment deletion cascade.** Tombstone pattern is defined here but implementation is deferred to the Tasks module PRD.
- **Data export before deletion.** GDPR right-to-portability export. Post-MVP.
- **Deletion reason capture.** Requiring a justification or reason when deleting an employee. Post-MVP.
- **Audit log UI.** A dedicated audit log page or modal. The log table is defined here; the UI for browsing it is a separate feature.
- **Retention sweep.** Automated deletion of audit log entries older than N days. Service-role access is pre-authorised for this; the sweep logic itself is post-MVP.

---

# Dependencies

- 03-employees.md must be fully implemented and stable. The Server Actions, RPCs, and views introduced in that PRD are extended (not replaced) by this one.
- The Teams module (`02-teams.md`) is affected by the `team_members` FK change. The Teams agent must be notified before the migration for this PRD is applied.
- pg_cron extension must be enabled in the Supabase project. Confirmed available per RD-05; the deletion migration enables it via `CREATE EXTENSION IF NOT EXISTS pg_cron;`.
- `20260818000001_grant_service_role_table_privileges.sql` must be applied before this migration (it provides ALTER DEFAULT PRIVILEGES that covers the new `employee_lifecycle_log` table).
