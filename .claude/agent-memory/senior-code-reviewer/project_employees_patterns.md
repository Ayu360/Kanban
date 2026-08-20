---
name: Employees Module Backend Patterns
description: Established patterns from the Employees module backend review (reviewed 2026-08-15) and hotfix review (2026-08-18); service-role RPC pattern, banUser ID contract, middleware status-claim guard, service-role table grants
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

Frontend Employees module patterns (reviewed 2026-08-15):
- `EmployeesPageContent` uses `useState<Set<string>>` per-row loading per M-3 Teams pattern; confirmed correct.
- `useFocusTrap(true)` (always-open) used for always-mounted modals (InviteEmployeeModal, AddMemberModal); `useFocusTrap(isOpen)` for toggled dialogs (EmployeeConfirmDialog). Both are correct per Teams pattern.
- `AddMemberModal` has a `teamId` prop declared in interface but NOT destructured or used. This is a dead-prop bug — `onSubmit` receives the full `profileId` and the caller (TeamMembersList) passes teamId to its own mutation, not through AddMemberModal.
- Listbox in AddMemberModal lacks ArrowUp/ArrowDown keyboard navigation — uses `<button role="option">` click-only selection; WAI-ARIA listbox requires keyboard navigation of options via arrow keys.
- EmployeeConfirmDialog does NOT focus the Cancel button first on destructive variant. useFocusTrap focuses first focusable element = Cancel button because Cancel comes before Confirm in DOM order. This is actually WCAG-safe by DOM order, not autoFocus.
- `/accept-invite` success state is missing `role="status"` / `aria-live` — screen readers may not announce the "Account activated!" message before the redirect fires.
