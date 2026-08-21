---
name: Employees Module Backend Patterns
description: Established patterns from Employees module backend reviews (2026-08-15, 2026-08-18, 2026-08-20); service-role RPC pattern, banUser ID contract, middleware status-claim guard, service-role table grants, lifecycle deletion actions
type: project
---

Service-role RPC pattern is established: `change_employee_role`, `deactivate_employee`, `reactivate_employee` are all called via service-role; `auth.uid()` returns NULL inside the SECURITY DEFINER RPCs, so the DB G-guards do NOT fire. The service layer is the sole auth gate for these paths. This is intentional and matches the Teams precedent (addMember, delete via service-role).

**Why:** Teams module established this pattern; reviewed and approved across three cycles. DB G-guards are defense-in-depth only when called with an authenticated session (e.g., from a direct REST call) — not on the service-role path.

**How to apply:** When reviewing mutations in this project that call RPCs via service-role, confirm the service layer has ALL the necessary guards (admin check, self-modification, cross-company, last-admin) because the DB guards will not fire. Flag any gap as High/Critical.

---

`banUser(targetProfileId)` is correct: in Supabase, `profiles.id` and `auth.users.id` share the same UUID (established at signup/invite). The profile ID IS the Auth user ID.

---

Last-admin lockout for DEACTIVATION is handled at the DB layer (G7 in `deactivate_employee`). Under service-role, `auth.uid()` returns NULL, so G7 will NOT fire. The service layer does NOT independently check last-admin before deactivating. This is an active gap — if a company admin calls `deactivateEmployee` on the last admin, the DB guard is bypassed and the company can be locked out.

**Status as of 2026-08-15:** Flagged as HIGH finding in review. Service must add an explicit last-admin count check before calling `repo.deactivate()` for the deactivation path.

---

`employee_directory` view filters `status != 'deactivated'` — meaning PENDING employees ARE included in the directory. Handoff doc notes this and flags it as an open question for product. Client-side filter by `displayName !== null` can exclude pending employees from pickers if needed.

---

---

Service-role table grants gap (resolved 2026-08-18): All prior migrations granted privileges to `authenticated` only. `SECURITY DEFINER` RPCs masked this because they run as postgres/superuser. Direct service-role table writes (INSERT/DELETE on `team_members`, `teams`, `profiles`) required migration `20260818000001_grant_service_role_table_privileges.sql`. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` is now set — future tables will inherit grants automatically. Pattern: any new direct service-role table write should be tested explicitly; do not assume grants are present on brand-new tables until after the default-privileges migration runs for the first time on a fresh DB.

**Why:** Bug manifested as 42501 on `team_members` INSERT when `addMember` dropped SECURITY DEFINER wrapper.

**How to apply:** When reviewing new direct service-role table writes (not via RPC), confirm this migration has already run on that DB. Post-20260818000001, future tables in public will be auto-granted. Pre-20260818000001 environments (fresh dev DB reset before migration) would still hit 42501 on any table created before this migration ran.

---

`removeMember` (SupabaseTeamsRepository) uses service-role with `.eq('team_id', teamId).eq('profile_id', profileId)` — no company_id scope filter. Cross-company safety relies entirely on the `team_members` table having a FK to `teams(id)`, combined with the service layer checking admin permission. The DB architect's concern about a missing company_id filter is partially mitigated because you cannot remove a member from a team you don't own unless you know both the teamId AND the profileId, and both IDs are UUIDs obtained through the authenticated session. Assessed as acceptable tech debt for current single-company MVP. If cross-company admin capabilities are ever added, `removeMember` should gain a company_id filter.

---

--- PRD 05 Employee Lifecycle Deletion (all layers, RV-1 final review 2026-08-21, GREEN) ---

`softDeleteEmployeeAction` double-log was FIXED in the backend revision. The action no longer calls `writeLifecycleLog` — the RPC handles the `soft_deleted` log atomically. The `writeLifecycleLog` import in `employeesLifecycleActions.ts` is used only by `resendInviteAction`. No double-log exists in the shipped code.

`changeEmployeeRoleAction` logs `role_changed` even on noop (when old_role === new_role). Deferred low-priority cleanup; not re-flagged in RV-1.

PRD 05 Frontend Phase 3 (FE-2, FE-3, FE-4) passed RV-1 with one YELLOW should-fix: the `cancel-scheduled-deletion` dialog uses `cancelLabel="Dismiss"` while PRD 05 copy table specifies `cancelLabel="Keep"` (or equivalent non-"Dismiss" wording). All other dialog copy, quorum checks, badge precedence, polling logic, and race-case handling verified correct end-to-end.

`_promote_scheduled_deletions` cron function writes the `hard_deleted` log AFTER the confirmed DELETE (not before, unlike `hard_delete_employee` which writes before). This is intentional and safe for the cron path: actor_profile_id is NULL in the cron context so no pre-delete FK capture is needed for the actor; target identity is captured from the loop-SELECT snapshot before DELETE; the log write happens inside the same transaction loop iteration. Verified correct.

Auth-sweep cron `/api/cron/sweep-orphaned-auth` uses `CRON_SECRET` missing-check that returns 503 (not 401) when unconfigured — deliberate fail-closed behavior. Pattern confirmed correct.

`hasOtherAdmin` quorum check in `EmployeesPageContent` derives from the in-memory `employees` list via `useMemo` — no extra fetch. Checked correctly: `role === 'admin' && status !== 'deactivated' && id !== user.id`. Note: does NOT exclude grace-window employees (deletionScheduledAt !== null) from the admin quorum count. An admin in the grace window (banned, access revoked) still counts as a quorum admin. This is a known edge-case risk but acceptable for MVP single-company context — the DB guard (G3) in `soft_delete_employee` uses the same count logic.

Last-admin lockout in the new lifecycle actions (soft_delete, hard_delete) fires only for self-delete (`caller.id === targetProfileId`). A platform admin can hard-delete or schedule the only remaining company admin without being blocked — pre-existing architectural gap, not introduced in PRD 05.

`undoScheduledDeletionAction` maps `{ success: false, reason: 'already_deleted' }` from the RPC into `ActionResult.success = true, data.cancelled = false`. This is a deliberate design choice (the admin's intent is satisfied). The frontend must check `result.success === true && !result.data.cancelled && result.data.reason === 'already_deleted'` to detect the cron-won-the-race case.

`LogWriteError` sentinel class pattern is established: thrown by `writeLifecycleLog` on INSERT failure, callers catch it and console.error, primary ActionResult is unaffected. Log failure is an ops concern, not a user-facing error. This pattern is now project convention for all lifecycle log writes.

Auth-sweep cron (`/api/cron/sweep-orphaned-auth`): 10-minute grace window on `created_at` is a hard constraint — do not remove. Prevents sweeping freshly invited auth.users rows before the profiles row is inserted by `inviteEmployeeAction`. Batch IN() query for profile existence check: established pattern for efficiency.

---

Frontend Employees module patterns (reviewed 2026-08-15):
- `EmployeesPageContent` uses `useState<Set<string>>` per-row loading per M-3 Teams pattern; confirmed correct.
- `useFocusTrap(true)` (always-open) used for always-mounted modals (InviteEmployeeModal, AddMemberModal); `useFocusTrap(isOpen)` for toggled dialogs (EmployeeConfirmDialog). Both are correct per Teams pattern.
- `AddMemberModal` has a `teamId` prop declared in interface but NOT destructured or used. This is a dead-prop bug — `onSubmit` receives the full `profileId` and the caller (TeamMembersList) passes teamId to its own mutation, not through AddMemberModal.
- Listbox in AddMemberModal lacks ArrowUp/ArrowDown keyboard navigation — uses `<button role="option">` click-only selection; WAI-ARIA listbox requires keyboard navigation of options via arrow keys.
- EmployeeConfirmDialog does NOT focus the Cancel button first on destructive variant. useFocusTrap focuses first focusable element = Cancel button because Cancel comes before Confirm in DOM order. This is actually WCAG-safe by DOM order, not autoFocus.
- `/accept-invite` success state is missing `role="status"` / `aria-live` — screen readers may not announce the "Account activated!" message before the redirect fires.
