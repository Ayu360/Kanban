# Employees — Product Requirements Document

---

# Overview

The Employees module manages the `profiles` rows that represent users within a company. It covers viewing the employee roster, inviting new employees via email, promoting and demoting employees between the `admin` and `employee` roles, and deactivating employees. All management operations are restricted to company admins and platform admins. Regular employees have read-only access to a minimal directory view. Platform admin management via the customer-facing UI is explicitly out of scope for MVP.

This module depends on Authentication (01-authentication.md). It should be implemented after Authentication is complete and merged.

---

# Goals

1. Company admins can view a complete list of all employees in their company.
2. Company admins can invite new users to join the company via email.
3. Company admins can promote an employee to admin or demote an admin back to employee.
4. Company admins can deactivate an employee, preventing their future login without deleting their data.
5. Employees have read access to a limited directory (names, for use in task assignment and team member displays) but cannot see management controls or perform management actions.
6. Platform admins can perform all management operations across any company.

---

# Non Goals

- Platform admin management via the customer-facing UI (granting or revoking `is_platform_admin` from the UI). The flag exists in the schema and the bootstrap sets it; an admin console UI is post-MVP.
- Hard deletion of employee records — deactivation is the MVP mechanism. Deletion may be added post-MVP.
- Employee self-service profile editing beyond what Supabase Auth provides (e.g., changing their own display name) — post-MVP.
- Bulk import of employees (CSV upload, directory sync, SCIM) — post-MVP.
- Employee skill or department metadata — post-MVP.
- Invitation via a shareable link (rather than a direct email invite) — post-MVP.

---

# User Stories

1. As a company admin, I can view the full list of employees in my company (name, email, role, status) so that I have visibility into my team.
2. As a company admin, I can invite a new employee by entering their email address so that they receive an invitation and can join the company.
3. As a company admin, I can promote an employee to admin role so that they gain management capabilities.
4. As a company admin, I can demote an admin back to employee role so that their management privileges are revoked.
5. As a company admin, I can deactivate an employee so that they can no longer log in, without losing their historical task data.
6. As a company admin, I can reactivate a previously deactivated employee.
7. As an employee, I can view a minimal directory of names in my company (for purposes like seeing who is assigned to a task) but I cannot see management controls.
8. As a platform admin, I can perform all of the above actions on employees in any company.

---

# Functional Requirements

## FR-01: Employee List (Admin View)

- Company admins see a table or list of all `profiles` rows with `company_id` matching their own.
- Columns displayed: display name, email address, role (`Admin` or `Employee`), status (Active or Deactivated).
- The list is sorted alphabetically by display name by default.
- Search/filter by name or email is supported client-side or via a query parameter.
- The list is fetched via a TanStack Query hook. RLS scopes the result to the admin's `company_id` automatically.

## FR-02: Employee Invitation

- A company admin enters an email address to invite a new employee.
- The invitation is sent as a Supabase Auth invite email (a magic link that lets the new user set their password on first visit).
- On invitation submission, a Server Action is called that:
  1. Validates that the email is not already registered in the company.
  2. Calls the Supabase Auth admin API to create the invite (this requires the service-role key).
  3. Creates a `profiles` row for the invited user with `role = 'employee'`, `company_id` set to the inviting admin's company, and `is_platform_admin = false`.
  4. Returns success. The invited user receives an email with a link to set their password and access the application.
- If the email is already registered in any Supabase Auth account (within or outside the company), the Server Action returns a user-visible error: "This email address is already registered."
- The invited user's profile row exists in the database immediately after the invitation is sent. If the user never accepts the invite, the profile row remains in an "invited" or "pending" state (tracked via `is_active = false` or a separate status column — see Database Requirements).
- Inviting an email that already has a pending (not-yet-accepted) invitation is a no-op; the existing invitation is not re-sent. The admin sees a message: "An invitation has already been sent to this address."

## FR-03: Role Promotion and Demotion

- A company admin can toggle the `role` of any employee in their company between `'employee'` and `'admin'`.
- A company admin cannot change their own role (to prevent self-demotion lockout). The UI hides the role control for the admin's own row; the Server Action also validates this.
- The role change is implemented as a Server Action because it modifies a privileged field (`role`).
- A platform admin is not subject to the self-demotion restriction for company-role changes (they can demote a company-admin row that happens to be their own profile's company role, since they retain platform-admin access).
- After a role change, the affected user's next authenticated request reflects the new role. If a currently-active session needs to reflect the change immediately (e.g., to revoke admin UI access), the user may need to sign out and back in for the JWT to refresh. This is documented behavior and is acceptable in MVP.

## FR-04: Employee Deactivation and Reactivation

- A company admin can deactivate an employee. Deactivation sets `is_active = false` on the profile (see Database Requirements) and blocks the Supabase Auth account (via the service-role API in the Server Action).
- A deactivated employee cannot log in. If they attempt to, the login flow returns a generic authentication failure.
- A company admin can reactivate a deactivated employee, restoring their `is_active = true` and unblocking their Supabase Auth account.
- Deactivation and reactivation are Server Actions (they require the service-role key to modify Supabase Auth account state).
- Deactivated employees are shown in the admin list with a "Deactivated" status. They are excluded from the employee picker used in team-member addition and task assignment.
- A company admin cannot deactivate themselves. The UI hides the deactivate control for the admin's own row; the Server Action validates this.

## FR-05: Employee Directory (Employee View)

- Employees (non-admin) can access a read-only directory listing the names and roles of other employees in the same company.
- The directory is used internally across features (e.g., the task assignee picker, the team member display) and may or may not be exposed as a standalone page in MVP.
- No management controls (invite, promote, demote, deactivate) are visible to non-admin users.
- The data is scoped by RLS to the user's `company_id`.

---

# Business Rules

- Per ADR-0006, every `profiles` row carries `company_id NOT NULL`. Invited employees are always assigned to the inviting admin's `company_id`. There is no concept of a user without a company in MVP.
- Per ADR-0007, `role` lives in `profiles.role`, constrained to `'admin'` or `'employee'`. It is not stored in Supabase Auth metadata.
- Per ADR-0008, `is_platform_admin` is orthogonal to `role`. Platform admin management via the UI is out of scope for MVP. The field exists in the schema and is set only by the first-user-wins bootstrap (ADR-0014) during this MVP.
- Per ADR-0015, invitation (uses service-role key for Auth admin API), role changes (privileged write to `profiles.role`), and deactivation/reactivation (Auth account block/unblock) are all Server Actions. Simple reads (employee list, directory) are client-side Supabase queries scoped by RLS.
- Per ADR-0003, RLS is the authorization boundary. Frontend role checks (hiding the "Promote" button from employees) are UX only. The Server Actions explicitly validate the caller's role before executing privileged writes.
- A company admin's own row is protected from self-modification of role and active status. The Server Action enforces this by checking whether the caller's `profile_id` matches the target `profile_id`.
- Deactivated employees retain all their historical data (tasks created by them, tasks assigned to them remain assigned). Task assignment display should handle the case where an assignee is deactivated (show name with a "Deactivated" indicator or similar).

---

# Edge Cases

1. **Inviting an email already registered in Supabase Auth:** The Server Action catches the conflict and returns a clear error. No duplicate auth user is created.
2. **Inviting an email that already has a `profiles` row in this company (e.g., a re-invite after a previous failed invite):** The Server Action checks for an existing profile with the email in the company and returns an appropriate message ("An invitation has already been sent" or "This employee is already in your company").
3. **Admin demotes themselves:** The Server Action rejects the operation and returns an error. The UI pre-empts this by not showing the demotion control on the admin's own row.
4. **Admin deactivates themselves:** The Server Action rejects the operation. The UI pre-empts this.
5. **Deactivating a user who is currently logged in:** Their active session continues until the cookie expires or they make a request that triggers a session refresh. On the next session validation, the account block from Supabase Auth causes the session check to fail and they are redirected to `/login`. This is acceptable behavior and is documented.
6. **Reactivating a user who does not remember their password:** The admin can reactivate the account, and the user uses the "Forgot password" flow to reset it. No special handling needed beyond standard password reset.
7. **An invited user never accepts the invitation:** The profile row persists in an inactive/pending state. The admin can see it in the list. The admin can re-send an invitation (if implemented) or deactivate/delete the pending profile in post-MVP. In MVP, pending rows are shown in the employee list with a "Pending" status.
8. **A platform admin calls a role-change action on a profile in a different company:** The Server Action validates the action using the platform-admin flag, which bypasses the company-scoped check. The operation is permitted.
9. **Attempting to set `is_platform_admin` via the employee management UI:** No UI control for this exists in MVP. The Server Actions for employee management do not accept or process changes to `is_platform_admin`. Any attempt to pass this field is ignored or rejected.

---

# UI Requirements

- The employees management page is accessible at a route such as `/employees` (protected; only company admins and platform admins see management controls — employees see the directory-only view or are redirected to a minimal page).
- Admin view: a table with columns for name, email, role badge (Admin / Employee), status badge (Active / Pending / Deactivated), and an actions menu per row.
- Actions menu per row (admin view): Promote to Admin / Demote to Employee (toggle based on current role), Deactivate / Reactivate (toggle based on current status). Both actions are absent on the admin's own row.
- An "Invite employee" button opens a modal with a single email input field and a submit button.
- Pending invitations are displayed in the list with a "Pending" status badge and no role-change or deactivation controls (only a potential "Resend invite" in post-MVP).
- Deactivated employees appear in the list with a "Deactivated" badge and a "Reactivate" action. They are visually de-emphasized (muted text color).
- Search/filter: a text input filters the list by name or email in real time on the client.
- Loading and empty states are required. Empty state message: "No employees yet. Invite someone to get started."
- All management controls are absent in the employee (non-admin) view. The employee directory view, if shown as a standalone page, is read-only with no action controls.
- Role change and deactivation confirmations: role promotion/demotion shows a brief confirmation dialog. Deactivation shows a more prominent confirmation dialog explaining that the user will lose login access.

---

# Backend Requirements

- `EmployeesRepository` interface in `src/features/employees/repositories/EmployeesRepository.ts`. Methods include: `listByCompany`, `getById`, `updateRole`, `updateActiveStatus`, `getByEmail`.
- `SupabaseEmployeesRepository` in `src/features/employees/repositories/SupabaseEmployeesRepository.ts` implements the interface.
- `EmployeesService` in `src/features/employees/services/employeesService.ts` contains business rules: validates self-modification restrictions, checks for duplicate invites, orchestrates invite + profile creation.
- Server Actions in `src/features/employees/services/employeesActions.ts` (marked `'use server'`): `inviteEmployeeAction`, `changeRoleAction`, `deactivateEmployeeAction`, `reactivateEmployeeAction`.
- `inviteEmployeeAction` uses the service-role Supabase client to call the Auth admin API (`auth.admin.inviteUserByEmail`). It then inserts a `profiles` row for the invited user.
- `changeRoleAction` uses the service-role client to update `profiles.role`. It validates that the caller is a company admin or platform admin and that the caller is not modifying their own row.
- `deactivateEmployeeAction` and `reactivateEmployeeAction` use the service-role client to call `auth.admin.updateUserById` to ban/unban the account, and update `profiles.is_active` accordingly.
- TanStack Query hooks in `src/features/employees/hooks/`: `useEmployees` (list, admin query key `['employees', 'list', { companyId }]`), `useEmployee` (single), `useEmployeeDirectory` (employee-facing lighter query).
- Per ADR-0013, after any mutation, invalidate `['employees']` to refresh the list.
- Per ADR-0004, all Supabase and Supabase Auth errors are caught at the repository layer and normalized to the project error type. Auth admin API errors are handled in the Server Action and returned as typed error results.
- The composition root (`src/lib/container.ts`) wires `SupabaseEmployeesRepository`.

---

# Database Requirements

Described in prose only. SQL lives in `supabase/migrations/`.

- The `profiles` table (defined in the Authentication module) is the core table for this feature. This module adds an `is_active` boolean column (non-nullable, defaults to true) to track deactivation state. Pending invitations are also represented here: a profile is created at invite time with `is_active = false` (or a separate `status` enum column: `'active'`, `'pending'`, `'deactivated'`).
  - Recommended: a `status` enum column with values `'active'`, `'pending'`, `'deactivated'` is more expressive than a boolean and avoids ambiguity between "not yet accepted invitation" and "admin-deactivated." The Authentication PRD should be updated to reflect this column; it does not need to expose it in the auth flows but the column must exist from the initial migration.
- RLS on `profiles` (reads): an employee can read all profiles with the same `company_id` (for the directory). A company admin can read all profiles with the same `company_id`. A platform admin can read all profiles.
- RLS on `profiles` (writes for role and status columns): direct writes from the client are not permitted. Only Server Actions using the service-role key modify `role`, `is_active` / `status`, or `is_platform_admin`. RLS update policies for these columns restrict them to service-role only or to rows where the caller is an admin and the target is in the same company. The cleanest implementation is to use the service-role key in Server Actions and rely on application-layer validation rather than per-column RLS update policies for role/status fields.
- No new tables are introduced by the Employees module. It operates on `profiles` (and calls the Supabase Auth admin API for invite and ban operations).

---

# Validation Rules

- Invitation email: must be a valid email format. Validated client-side and by the Server Action before calling the Supabase Auth API.
- Role value: must be `'admin'` or `'employee'`. The database `CHECK` constraint is the enforcement layer; the Server Action also validates the value before calling the repository.
- Self-modification: the caller's `profile_id` must not equal the target `profile_id` for role change or deactivation operations. Validated in the Server Action.
- Company scope: for company admins (non-platform admins), the target profile's `company_id` must equal the caller's `company_id`. Validated in the Server Action.
- Invite target: the email must not already exist in the `profiles` table for this company. Validated in the Server Action before calling the Auth admin API.

---

# Acceptance Criteria

1. A company admin submits an invitation to `alice@example.com`. Alice receives an email. The employee list shows Alice with "Pending" status. Alice follows the link, sets her password, and logs in. Her profile now shows "Active" status and `role = 'employee'`.
2. A company admin promotes Alice to Admin. Alice's row in the employee list shows the "Admin" badge. Alice logs out and back in; she now sees admin controls throughout the application.
3. A company admin demotes Alice back to Employee. Alice's row shows the "Employee" badge. After re-login, Alice no longer sees admin controls.
4. A company admin attempts to change their own role. The UI hides the control on their own row. If they attempt the action via the Server Action directly, the action returns a permission error without modifying the database.
5. A company admin deactivates Bob. Bob's row shows "Deactivated" status. Bob attempts to log in and receives an authentication failure. Bob does not appear in the employee picker for task assignment.
6. A company admin reactivates Bob. Bob can log in again. Bob's tasks and history are intact.
7. An employee (non-admin) navigates to the employees page. They see only the read-only directory (names and roles) without any action controls. No invite, promote, demote, or deactivate buttons are visible.
8. Inviting an email that is already registered returns a user-visible error message and does not create a duplicate profile row.
9. A platform admin can perform all of the above operations on employees in the default company without holding `role = 'admin'` in their own profile.
10. The `is_platform_admin` flag cannot be set or unset through any action in the employees management UI.

---

# Dependencies

- Authentication module (01-authentication.md) must be complete. The `profiles` table, `companies` seed, and `useCurrentUser()` hook must exist.
- Teams module (02-teams.md): the employee picker used in team member addition queries the same employee data layer. These two modules can be developed in parallel, but the full team-member add flow requires the employees data layer to be functional.
- Database migration extending `profiles` with the `status` column (or `is_active` boolean) must run.

---

# Future Enhancements

- Platform admin management UI (granting and revoking `is_platform_admin` from a dedicated admin console).
- Hard deletion of employee records with data reassignment (e.g., unassign all tasks before deletion).
- Employee self-service profile editing (display name, avatar).
- Bulk employee import via CSV or directory integration (SCIM/LDAP).
- Invitation expiry and re-send functionality.
- Employee activity log (last login, number of tasks owned).
- Role-per-team model (a `role` column on `team_members`) once the base team membership model is established.
