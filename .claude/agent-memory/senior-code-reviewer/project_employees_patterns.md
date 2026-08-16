---
name: Employees Module Backend Patterns
description: Established patterns from the Employees module backend review (reviewed 2026-08-15); service-role RPC pattern, banUser ID contract, middleware status-claim guard
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
