---
name: Employees Module DB Layer
description: Key facts about the employees module migration — what was added to profiles, which RPCs/views exist, JWT hook change, and what was deliberately omitted. Rev 3 H-2 policy drop.
type: project
---

Migration `20260816000002_employees_schema.sql` implements the Employees module (rev 3, 2026-08-15 H-2 base-table policy drop).

**What was added to `public.profiles`:**
- `status text NOT NULL DEFAULT 'active'` with CHECK `('active','pending','deactivated')`
- `deactivated_at timestamptz NULL` with CHECK enforcing invariant: NOT NULL ↔ status = 'deactivated'
- Index `idx_profiles_company_id_status` on `(company_id, status)`
- `public.custom_access_token_hook` updated in-place to inject `status` into JWT app_metadata

**H-2 base-table policy (rev 3 change):**
- `profiles_select_employee_directory` is DROPPED (not added) by this migration.
- Previously it gave plain employees company-scoped SELECT on the full base table (including `status`, `is_platform_admin`, `deactivated_at`) — REST bypass risk.
- The three auth-migration policies already cover all legitimate access: `profiles_select_own` (self), `profiles_select_company_admin` (admins), `profiles_select_platform_admin` (platform admin).
- Plain employees have NO base-table SELECT policy — direct REST calls to `/rest/v1/profiles` return empty. Their sole access path is `public.employee_directory`.

**Views:**
- `public.employee_directory` — projects `id, display_name, role` only; excludes deactivated; company-scoped via JWT; GRANT to `authenticated`
- `public.admin_employee_list` — full projection joining `profiles + auth.users` for email; includes `status`, `deactivated_at`, `is_platform_admin`; GRANT to `service_role` ONLY; NOT company-scoped in view (caller applies WHERE)

**SECURITY DEFINER RPCs:**
- `change_employee_role(uuid, text)` → service_role — G5 admin count filters out deactivated admins
- `deactivate_employee(uuid)` → service_role — guards pending (raises `invalid_parameter_value`), sets `deactivated_at`
- `reactivate_employee(uuid)` → service_role — clears `deactivated_at`
- `activate_invited_employee()` → authenticated (NOT service_role) — self-activation, no params, reads auth.uid(); idempotent on active; raises on deactivated

**Removed:** `get_profile_status` helper (was unused, misleading — deleted in rev 2)

**Step ordering for deactivate/reactivate:**
- DB RPC is ALWAYS called first (authority). Auth ban/unban is the trailing side effect.
- Deactivate: RPC first → Auth ban. Reactivate: RPC first → Auth unban.

**Last-admin lockout:** enforced in both `change_employee_role` (G5, filters deactivated) and `deactivate_employee` (G7). Raises `check_violation` with prefix `last_admin_lockout:`.

**Why:** DB agent rev 2 fix pass on 2026-08-15 (reviewer APPROVED WITH NOTES — 2 High, 4 Medium, 3 Low).
**How to apply:** When extending employees features, use the views for reads. Use service-role client for admin RPCs. Use authenticated client for `activate_invited_employee`.
