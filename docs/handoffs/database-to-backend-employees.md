# Employees Database → Backend Handoff

**Migration file:** `supabase/migrations/20260816000002_employees_schema.sql`
**Status:** DATABASE LAYER IMPLEMENTED — READY FOR BACKEND INTEGRATION (rev 3, H-2 base-table policy drop + NEW-1 documented)
**Date:** 2026-08-16
**Prepared by:** Database Agent

---

## Overview

The Employees module database layer extends `public.profiles` with a `status` column and adds four SECURITY DEFINER RPCs for privileged writes. No new tables are created — the PRD explicitly states "No new tables are introduced by the Employees module." All invitation work routes through `auth.admin.inviteUserByEmail` (Supabase Auth admin API).

### Key Design Decisions

**`status` column over `is_active` boolean.** The PRD recommends this. A three-value enum (`active`, `pending`, `deactivated`) removes ambiguity between "not yet accepted invite" and "admin-deactivated." Implemented as `text NOT NULL DEFAULT 'active'` with a CHECK constraint — same pattern as `profiles.role` — because `ALTER TYPE` on a Postgres enum is lock-heavy and harder to roll back.

**No `employee_invitations` table.** Supabase Auth handles invite token generation, expiry, and email delivery via `auth.admin.inviteUserByEmail`. The Server Action inserts a `profiles` row with `status = 'pending'` immediately at invite time. If the invited user never accepts, the pending profile persists and is visible in the admin list.

**JWT hook updated in-place (`CREATE OR REPLACE`) to include `status` claim.** Middleware reads `status` from the JWT to block deactivated sessions without a DB round-trip. The alternative (middleware queries `profiles` on every request) was rejected for adding synchronous DB latency to every server-side render. The 1-hour JWT TTL means deactivation is not immediate for the existing session — the Server Action must also call `auth.admin.banUser()` (which Supabase uses to invalidate the session immediately) for real-time enforcement. Both steps are required.

**Last-admin lockout enforced at the DB layer.** Both `change_employee_role` (demotion) and `deactivate_employee` check that at least one other non-deactivated admin remains in the company. This is defense-in-depth — the Server Action should check too, but the DB is the final authority.

**`deactivated_at` audit column.** `profiles.deactivated_at TIMESTAMPTZ NULL` records the timestamp of the most recent deactivation (PRD EC-5). Set by `deactivate_employee`, cleared to NULL by `reactivate_employee`. A CHECK constraint enforces the invariant: `deactivated_at IS NOT NULL` if and only if `status = 'deactivated'`.

**Projected views replace direct base-table access for directory/list reads (H-2).** Two views are the correct data access path for non-own-row reads: `public.employee_directory` (safe column projection, granted to `authenticated`) and `public.admin_employee_list` (full projection including email from `auth.users`, granted to `service_role` only). This resolves Q1 (email without a separate Auth admin API call) and prevents `status`/`is_platform_admin` from leaking to plain employees via direct REST calls.

**`activate_invited_employee()` RPC (Q2).** Self-activation function for the invite-acceptance flow. Called from the invited user's browser session (granted to `authenticated`, NOT `service_role`). No parameters — target is always `auth.uid()`. This is the only RPC callable by authenticated (non-admin) users.

**No new migration file for the JWT hook.** The hook function signature is unchanged; `CREATE OR REPLACE` updates it in place. The Supabase Dashboard hook registration does not need to be re-done.

### Rejected Alternatives

| Alternative | Reason rejected |
|---|---|
| `employee_invitations` table | PRD says no new tables; Supabase Auth handles tokens natively |
| `is_active boolean` column | Ambiguous — does `false` mean pending or deactivated? `status` is explicit |
| Separate migration file for JWT hook update | The hook signature is unchanged; in-place replacement is cleaner and avoids a superfluous migration |
| Middleware queries `profiles` on every request | Adds synchronous DB latency; JWT claim is the established project pattern |
| Column-level RLS for role/status writes | Auth migration already established that role/status writes go through service-role only; per-column RLS is redundant complexity |

---

## Public Database Contract

### Modified Tables

#### `public.profiles` (new columns)

| Column | Type | Nullable | Default | Constraint |
|---|---|---|---|---|
| `status` | `text` | NOT NULL | `'active'` | `CHECK (status IN ('active', 'pending', 'deactivated'))` |
| `deactivated_at` | `timestamptz` | NULL | — | `CHECK` — see below |

Both columns are added with `ADD COLUMN IF NOT EXISTS` — safe to run on a database with existing profile rows (they all default to `'active'` / `NULL`).

**Consistency constraint `profiles_deactivated_at_status_check`:** `(status = 'deactivated' AND deactivated_at IS NOT NULL) OR (status != 'deactivated' AND deactivated_at IS NULL)`. Prevents the "deactivated_at set but status active" and "status deactivated but no timestamp" combinations at the database level.

### New Index

| Name | Table | Columns | Query Pattern |
|---|---|---|---|
| `idx_profiles_company_id_status` | `profiles` | `(company_id, status)` | Employee list filtered by company + status; employee picker excluding deactivated users |

### RLS Policy Change (H-2 fix)

`profiles_select_employee_directory` is **dropped** by this migration — it is not added. The auth migration (`20260802000001`) already defines three SELECT policies on `profiles` that cover every legitimate access path:

| Policy (from auth migration) | Who | Access granted |
|---|---|---|
| `profiles_select_own` | Any authenticated user | Own row only |
| `profiles_select_company_admin` | Authenticated users with JWT `role = 'admin'` | All rows in their company |
| `profiles_select_platform_admin` | Authenticated users with JWT `is_platform_admin = true` | All rows across all companies |

Plain employees have no base-table SELECT policy in their favor after this migration runs. Their only access path for co-worker data is `public.employee_directory` (see views below). A direct REST call to `/rest/v1/profiles` from a plain employee session returns an empty result set — the RLS policy absence denies the rows silently per Postgres semantics.

### New Views

| View | Grants | Columns | Notes |
|---|---|---|---|
| `public.employee_directory` | `authenticated` (SELECT) | `id, display_name, role` | Scoped to caller's company via JWT. Excludes deactivated profiles. Use for task pickers, team member pickers. |
| `public.admin_employee_list` | `service_role` (SELECT) | `id, company_id, display_name, role, status, deactivated_at, is_platform_admin, created_at, email` | Joins `auth.users` for email. NOT company-scoped in the view — apply `WHERE company_id = $1` in the query. |

**Do NOT query the base `profiles` table for employee directory reads.** Use the appropriate view. `admin_employee_list` resolves Q1 (email without a separate Auth admin API call).

### New RPCs

All five functions are `SECURITY DEFINER` and `REVOKE`d from `PUBLIC`. Four are `GRANT`ed to `service_role`; `activate_invited_employee` is `GRANT`ed to `authenticated` (the invited user's own session).

#### `public.change_employee_role(p_target_profile_id uuid, p_new_role text) → jsonb`

Promotes or demotes a profile's role.

**Returns:**
```json
{ "success": true, "old_role": "employee", "new_role": "admin", "noop": false }
```

**Raises (SQLSTATE):**
| Condition | ERRCODE |
|---|---|
| Invalid role value | `check_violation` |
| Caller not admin/platform-admin | `insufficient_privilege` |
| Self-demotion by non-platform-admin | `insufficient_privilege` |
| Target not found | `no_data_found` |
| Cross-company target | `insufficient_privilege` |
| Last-admin lockout (demotion) | `check_violation` |

#### `public.deactivate_employee(p_target_profile_id uuid) → jsonb`

Sets `profiles.status = 'deactivated'`. Does NOT ban the Auth account — the Server Action must also call `auth.admin.banUser(userId)`.

**Returns:**
```json
{ "success": true, "previous_status": "active", "status": "deactivated", "noop": false }
```

**Raises:**
| Condition | ERRCODE |
|---|---|
| Caller not admin/platform-admin | `insufficient_privilege` |
| Self-deactivation | `insufficient_privilege` |
| Target not found | `no_data_found` |
| Cross-company target | `insufficient_privilege` |
| Target is `pending` (H-1) | `invalid_parameter_value` — revoke invite instead |
| Last-admin lockout | `check_violation` |

#### `public.reactivate_employee(p_target_profile_id uuid) → jsonb`

Sets `profiles.status = 'active'` and clears `deactivated_at`. Does NOT unban the Auth account — the Server Action must also call `auth.admin.updateUserById(userId, { ban_duration: 'none' })` AFTER this RPC.

**Returns:**
```json
{ "success": true, "previous_status": "deactivated", "status": "active", "noop": false }
```

**Raises:**
| Condition | ERRCODE |
|---|---|
| Caller not admin/platform-admin | `insufficient_privilege` |
| Target not found | `no_data_found` |
| Cross-company target | `insufficient_privilege` |
| Reactivating a pending profile | `invalid_parameter_value` |

#### `public.activate_invited_employee() → jsonb`

Self-activation RPC for invited users. Called from the invited user's own authenticated session (browser session, NOT service-role). No parameters — target is always `auth.uid()`.

**Caller:** `authenticated` (the invited user). Use the browser-session Supabase client, NOT `supabaseAdmin`.

**Transitions:** `pending` → `active`. Already-active is idempotent no-op. Raises on `deactivated` (admin must reactivate first).

**Returns:**
```json
{ "success": true, "previous_status": "pending", "status": "active", "noop": false }
```

**Raises:**
| Condition | ERRCODE |
|---|---|
| Not authenticated (no session) | `insufficient_privilege` |
| No profile row for current user | `no_data_found` |
| Profile is `deactivated` | `insufficient_privilege` |

---

## Authorization Model

| Action | Who can perform | Enforcement layer |
|---|---|---|
| Read employee directory (id, display_name, role) | Any authenticated user in same company | `public.employee_directory` view (H-2) |
| Read admin employee list (all columns + email) | Server Actions only | `public.admin_employee_list` view, service_role only (H-2, Q1) |
| Invite new employee | Company admin, platform admin | Server Action validates; DB has no policy — invite inserts a profile row via service-role |
| Accept own invite (pending → active) | Invited user (own session) | `activate_invited_employee()` RPC, granted to `authenticated` (Q2) |
| Change own `display_name` | Any authenticated user (own row only) | RLS: `profiles_update_own` + column-level GRANT (existing) |
| Promote/demote role | Company admin (not own row), platform admin | `change_employee_role` RPC (SECURITY DEFINER, service_role) |
| Deactivate | Company admin (not own row), platform admin | `deactivate_employee` RPC (DB first) + Server Action Auth ban (trailing) |
| Reactivate | Company admin, platform admin | `reactivate_employee` RPC (DB first) + Server Action Auth unban (trailing) |
| Modify `role`, `status`, `is_platform_admin` from anon-key session | Nobody | Column-level GRANT denies (existing); no authenticated GRANT on these columns |

### Last-Admin Lockout

Demotion (`change_employee_role` with `p_new_role = 'employee'`) and deactivation (`deactivate_employee`) both check that the target company has at least one other active admin before proceeding. The DB raises `check_violation` with the error message prefix `last_admin_lockout:` — catch by SQLSTATE or by error message prefix in the repository.

### Self-Modification Prevention

`change_employee_role` blocks self-demotion for non-platform admins (platform admins may demote their own company role — the PRD FR-03 explicitly permits this). `deactivate_employee` blocks self-deactivation for all callers.

---

## JWT Hook Changes

### What changed

`public.custom_access_token_hook` now reads `profiles.status` and injects it into `app_metadata` as `"status": "active" | "pending" | "deactivated"`.

### Middleware contract

```typescript
// In Next.js middleware (src/middleware.ts or similar):
const status = session?.user?.app_metadata?.status;

if (status === 'deactivated') {
  // User has been admin-deactivated. Redirect to login with error param.
  return NextResponse.redirect(new URL('/login?error=deactivated', request.url));
}

if (status === 'pending') {
  // User has a profile row but has not completed invite acceptance.
  // This branch should not occur in normal flow (Supabase Auth blocks login
  // until the invite is accepted). Guard defensively.
  return NextResponse.redirect(new URL('/login?error=pending', request.url));
}
```

### No Dashboard re-registration required

The hook function signature (`custom_access_token_hook(event jsonb) RETURNS jsonb`) is unchanged. The Supabase Dashboard registration under Authentication → Hooks → custom_access_token remains valid. No manual step is needed after running this migration.

### JWT staleness window

After `deactivate_employee` runs, the target user's JWT remains valid until its next refresh (default 1-hour Supabase TTL) **unless** the Server Action also calls `auth.admin.banUser(userId)`. The Auth ban invalidates the session immediately — Supabase rejects the refresh token on the next use. Both steps are mandatory for real-time deactivation. The PRD documents this behavior as acceptable.

---

## Cross-Team Handoffs

### Backend Agent: Required Implementation

1. **`inviteEmployeeAction` Server Action:**
   - Use service-role client to call `supabase.auth.admin.inviteUserByEmail(email, { data: {} })`.
   - After the Auth call succeeds, insert a `profiles` row: `{ id: newUser.id, company_id: callerCompanyId, role: 'employee', status: 'pending', display_name: null }`.
   - Check for existing profile with that email in the company BEFORE calling the Auth API (to return the "already invited" error without creating a duplicate auth user).
   - Catch `AuthApiError` for "email already registered" scenario.

2. **`changeRoleAction` Server Action:**
   - Call `supabase.rpc('change_employee_role', { p_target_profile_id, p_new_role })` via service-role client.
   - Catch exceptions by SQLSTATE or message prefix. Map to typed error results per ADR-0004.
   - No Auth API call needed — role changes do not affect Supabase Auth session state.

3. **`deactivateEmployeeAction` Server Action (two-step, DB first):**

   **Principle: DB is the authority; Auth ban is the trailing side effect in both directions.**

   - Step 1: Call `supabase.rpc('deactivate_employee', { p_target_profile_id })` via service-role. This updates `profiles.status = 'deactivated'` and sets `deactivated_at`. If this fails, stop — nothing is changed.
   - Step 2: Only if step 1 succeeds: call `supabase.auth.admin.updateUserById(targetAuthId, { ban_duration: '876000h' })` (practical permanent ban) to invalidate the session immediately.
   - If step 2 fails: the profile is already deactivated in the DB (the correct state). The next JWT refresh will carry `status = 'deactivated'` and middleware will block the user within 1 hour. Log the Auth-layer inconsistency for ops visibility and surface an error to the admin. Compensating action if you need immediate reversal: call `supabase.rpc('reactivate_employee', { p_target_profile_id })` to roll back the profile row, then retry.

4. **`reactivateEmployeeAction` Server Action (two-step, DB first):**

   **Principle: DB is the authority; Auth unban is the trailing side effect.**

   - Step 1: Call `supabase.rpc('reactivate_employee', { p_target_profile_id })` via service-role. This updates `profiles.status = 'active'` and clears `deactivated_at`. If this fails, stop — Auth remains banned (correct: user is still blocked).
   - Step 2: Only if step 1 succeeds: call `supabase.auth.admin.updateUserById(targetAuthId, { ban_duration: 'none' })` to unban.
   - If step 2 fails: the profile shows active in the DB but Auth still blocks login. Compensating action: call `supabase.rpc('deactivate_employee', { p_target_profile_id })` to roll back the profile row to `deactivated`, then retry the full flow.

5. **`EmployeesRepository`:**
   - **Employee directory** (task pickers, team member pickers): query `public.employee_directory` view — returns `id, display_name, role` for active users in the caller's company. Use the authenticated Supabase client. No extra WHERE clause needed (view handles company scoping via JWT).
   - **Admin employee list** (management UI): query `public.admin_employee_list` view with `WHERE company_id = $callerCompanyId ORDER BY display_name ASC NULLS LAST`. Use the service-role client. Includes `status`, `deactivated_at`, `is_platform_admin`, `email`.

6. **Invite flow — pending profile transition to active (Q2):**

   When a user accepts their invite (follows the magic link, sets password), Supabase Auth handles session creation. The profile row already exists with `status = 'pending'`. The accept-invite callback must:
   - Call `supabase.rpc('activate_invited_employee')` from the **browser session** (authenticated client, NOT service-role). The function reads `auth.uid()` internally.
   - This is idempotent — safe to retry on duplicate callback fires.
   - Do NOT use a direct service-role UPDATE — use the RPC so the guard against deactivated self-reactivation (Q2 requirement) is enforced.

### Frontend Agent

- **Employee picker (task assignment, team member addition):** route all reads through the `public.employee_directory` view, NOT the base `profiles` table. The correct REST call is:

  ```
  GET /rest/v1/employee_directory?select=id,display_name,role
  ```

  Do NOT add `company_id=eq.{companyId}` or `status=eq.active` filters — the view already applies both of these constraints internally (company scoping via JWT claim, deactivated profiles excluded by `WHERE status != 'deactivated'`). Adding them as client-side filters would be redundant and would break if the JWT claim format ever changes.

  **Do NOT query `/rest/v1/profiles` directly from the frontend.** After the H-2 fix, plain employees have no RLS policy granting them base-table access — a direct REST call returns an empty result set. Even if that were permitted, `profiles` exposes `status` and `is_platform_admin`, which must not be readable by non-admin users.

- Deactivated employees shown in admin list with "Deactivated" badge — `status = 'deactivated'`. This data comes from the `admin_employee_list` view via a Backend Server Action (service-role), never from a direct frontend query.
- Pending employees shown with "Pending" badge — `status = 'pending'`. No role-change or deactivate controls on pending rows. Same sourcing: Backend Server Action via `admin_employee_list`.
- The JWT `app_metadata.status` claim can be used in middleware to block deactivated sessions (see middleware contract above).

---

## Integration Test List for Backend Agent

The following scenarios should be covered by integration tests hitting a real database (per project testing conventions — no mocks):

| # | Scenario | Expected outcome |
|---|---|---|
| T1 | Company admin promotes employee to admin | `change_employee_role` returns `{success: true, new_role: 'admin'}` |
| T2 | Company admin demotes admin to employee (2+ admins exist) | Returns `{success: true, new_role: 'employee'}` |
| T3 | Company admin attempts to demote the LAST admin | Raises `check_violation` with `last_admin_lockout:` prefix |
| T4 | Company admin attempts to change their own role | Raises `insufficient_privilege` with `self_modification_denied:` prefix |
| T5 | Platform admin changes their own company role | Succeeds (platform admins exempt from self-modification guard) |
| T6 | Company admin deactivates an employee | `deactivate_employee` returns `{success: true, status: 'deactivated'}` |
| T7 | Company admin deactivates themselves | Raises `insufficient_privilege` with `self_deactivation_denied:` |
| T8 | Company admin deactivates the only active admin | Raises `check_violation` with `last_admin_lockout:` |
| T9 | Company admin reactivates a deactivated employee | Returns `{success: true, status: 'active'}` |
| T10 | Reactivating an already-active profile | Returns `{success: true, noop: true}` |
| T11 | Reactivating a `pending` profile | Raises `invalid_parameter_value` |
| T12 | Employee (non-admin) calls `change_employee_role` | Raises `insufficient_privilege` |
| T13 | Company admin targets a profile in a different company | Raises `insufficient_privilege` with `cross_company_denied:` |
| T14 | Invited employee profile has `status = 'pending'` | Confirmed via direct SELECT after `inviteEmployeeAction` |
| T15 | Invited employee accepts invite via `activate_invited_employee()` | Returns `{success: true, status: 'active', noop: false}`; profile row shows `status = 'active'` |
| T16 | `activate_invited_employee()` is idempotent when already active | Returns `{success: true, noop: true}` |
| T17 | `activate_invited_employee()` raises when profile is deactivated | Raises `insufficient_privilege` with `cannot_activate_deactivated:` prefix |
| T18 | Deactivated employee excluded from `employee_directory` view | SELECT from view returns 0 rows for deactivated user |
| T19 | Plain employee cannot see `status` via `employee_directory` view | View columns are `id, display_name, role` only |
| T20 | `admin_employee_list` returns email from `auth.users` | `email` column populated; matches `auth.users.email` for same user id |
| T21 | `admin_employee_list` not accessible via authenticated key | PostgREST request with anon/user JWT returns 0 rows or permission error |
| T22 | `deactivate_employee` on `pending` profile raises `invalid_parameter_value` | Error message prefix `cannot_deactivate_pending:` |
| T23 | `deactivate_employee` sets `deactivated_at` to a non-null timestamp | Confirmed via SELECT after deactivation |
| T24 | `reactivate_employee` clears `deactivated_at` to NULL | Confirmed via SELECT after reactivation |
| T25 | `change_employee_role` last-admin lockout ignores deactivated admins | Demoting last non-deactivated admin raises `check_violation` even if a deactivated admin exists |
| T26 | JWT hook includes `status` claim after deactivation + re-login | `session.user.app_metadata.status === 'deactivated'` |

---

## Deferred Items and Open Questions

1. **Q1 RESOLVED.** `public.admin_employee_list` view joins `auth.users` for email. No separate Auth admin API call needed for the employee list.

2. **Q2 RESOLVED.** `public.activate_invited_employee()` RPC added. Backend accept-invite callback calls `supabase.rpc('activate_invited_employee')` from the browser session (authenticated client).

3. **H-2 RESOLVED.** `public.employee_directory` view (authenticated) and `public.admin_employee_list` view (service_role only) replace direct base-table queries for directory/list reads.

4. **Re-send invite.** PRD lists it as post-MVP. No database work needed until then.

5. **`display_name` nullability.** Invited profiles have `display_name = null`. The employee list should fall back to `auth.users.email`. This is a repository/UI concern — the `admin_employee_list` view exposes `email` for exactly this fallback.

6. **`admin_employee_list` company scope.** The view is NOT pre-filtered by company. The Server Action must apply `WHERE company_id = $callerCompanyId`. Platform admins may query across companies by omitting the filter.

**NEW-1 (deferred):** `public.admin_employee_list` is not company-scoped in the view body. The Server Action that queries it MUST include `WHERE company_id = $callerCompanyId`. Immaterial in MVP (single company), fragile at multi-tenant scale. Revisit when platform admin cross-company reads become a product feature.
