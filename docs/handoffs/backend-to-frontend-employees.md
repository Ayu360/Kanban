# Backend → Frontend Handoff: Employees Module

**Status:** Backend implementation complete — ready for frontend integration.
**Branch:** `f/foundation-employees-module`
**Prepared by:** Backend Engineer

---

## Overview

The Employees module backend is fully implemented. This document describes every public interface the frontend needs to integrate, the routes to create, and the behavioral contracts to respect.

---

## Completed Backend Work

- `src/features/employees/types/index.ts` — `Employee`, `AdminEmployee`, `EmployeeStatus`, input/result types
- `src/features/employees/repositories/EmployeesRepository.ts` — interface (swap seam)
- `src/features/employees/repositories/SupabaseEmployeesRepository.ts` — Supabase implementation
- `src/features/employees/services/employeesService.ts` — business logic + authz
- `src/features/employees/services/employeesActions.ts` — Server Actions (`"use server"`)
- `src/features/employees/hooks/useEmployees.ts` — admin list hook + `employeesQueryKeys` factory
- `src/features/employees/hooks/useEmployee.ts` — single employee hook
- `src/features/employees/hooks/useEmployeeDirectory.ts` — directory hook (all authenticated users)
- `src/features/employees/hooks/useInviteEmployee.ts` — invite mutation
- `src/features/employees/hooks/useChangeEmployeeRole.ts` — role change mutation
- `src/features/employees/hooks/useDeactivateEmployee.ts` — deactivate mutation
- `src/features/employees/hooks/useReactivateEmployee.ts` — reactivate mutation
- `src/features/employees/hooks/useActivateInvitedEmployee.ts` — self-activation mutation
- `src/lib/container.ts` — `getEmployeesService()` registered
- `src/middleware.ts` — status claim checks added (deactivated/pending blocking)

---

## Public Interfaces

### Types

```typescript
// src/features/employees/types/index.ts

type EmployeeStatus = 'active' | 'pending' | 'deactivated';

// Directory shape — for task/team pickers (all authenticated users)
interface Employee {
  id: string;
  displayName: string | null;
  role: string;
}

// Full shape — admin management list only
interface AdminEmployee {
  id: string;
  companyId: string;
  displayName: string | null;
  email: string | null;  // from auth.users via view join
  role: string;
  status: EmployeeStatus;
  deactivatedAt: string | null;  // ISO timestamp or null
  isPlatformAdmin: boolean;
  createdAt: string;
}
```

### Hooks

```typescript
// Admin employee list
const { employees, isLoading, error } = useEmployees();
// employees: AdminEmployee[]
// Only enabled when user is admin or platform admin

// Single employee
const { employee, isLoading, error } = useEmployee(profileId);
// employee: AdminEmployee | null

// Directory for task/team pickers (all authenticated users)
const { employees, isLoading, error } = useEmployeeDirectory();
// employees: Employee[]  — no status, no email, no sensitive fields
// NOTE: Pending employees (displayName = null) ARE included — filter before rendering pickers:
//   employees.filter(e => e.displayName !== null)

// Mutations
const invite = useInviteEmployee();
invite.mutate({ email: 'alice@example.com' });

const changeRole = useChangeEmployeeRole();
changeRole.mutate({ targetProfileId: '...', newRole: 'admin' });

const deactivate = useDeactivateEmployee();
deactivate.mutate({ targetProfileId: '...' });

const reactivate = useReactivateEmployee();
reactivate.mutate({ targetProfileId: '...' });

// Invite acceptance callback — call after Supabase Auth session is established
const activate = useActivateInvitedEmployee();
activate.mutate();
```

### Query Key Factory

```typescript
import { employeesQueryKeys } from '@/features/employees/hooks/useEmployees';

employeesQueryKeys.all              // ['employees']
employeesQueryKeys.lists()          // ['employees', 'list']
employeesQueryKeys.list(companyId)  // ['employees', 'list', companyId]
employeesQueryKeys.details()        // ['employees', 'detail']
employeesQueryKeys.detail(id)       // ['employees', 'detail', id]
employeesQueryKeys.directory()      // ['employees', 'directory']
```

### Server Actions (if calling directly from Server Components)

```typescript
import {
  listEmployeesAction,
  listEmployeeDirectoryAction,
  getEmployeeAction,
  inviteEmployeeAction,
  changeEmployeeRoleAction,
  deactivateEmployeeAction,
  reactivateEmployeeAction,
  activateInvitedEmployeeAction,
} from '@/features/employees/services/employeesActions';
```

All return `ActionResult<T>` — a discriminated union. Always check `result.success` before reading `result.data`.

---

## Required Frontend Work

### 1. Route: `/employees` — Admin employee management page

**Who sees it:** Company admins + platform admins (full management UI). Plain employees — either redirect or show a read-only directory.

**Admin UI requirements (from PRD UI section):**
- Table with columns: Name, Email, Role badge (`Admin` / `Employee`), Status badge (`Active` / `Pending` / `Deactivated`), Actions menu.
- Actions menu per row:
  - Promote to Admin / Demote to Employee (toggle based on current role). **Hidden on the admin's own row.**
  - Deactivate / Reactivate (toggle based on current status). **Hidden on the admin's own row.**
  - No role or deactivate controls on `status === 'pending'` rows (pending employees have neither been promoted nor can be deactivated — use invite revocation in post-MVP).
- "Invite employee" button → modal with a single email input.
- Client-side search/filter by name or email.
- Empty state: "No employees yet. Invite someone to get started."
- Deactivated rows: show with "Deactivated" badge; visually de-emphasized.
- Pending rows: show with "Pending" badge; no role-change or deactivation controls.
- Confirmation dialogs: role change (brief), deactivation (prominent — explain login access is revoked).

**Data hook:** `useEmployees()` — returns `AdminEmployee[]`.

**displayName null handling:** Invited employees have `displayName = null` until they accept. Fall back to `email` for display. The `admin_employee_list` view surfaces both columns.

### 2. Route: `/accept-invite` — Invite acceptance callback

This route handles the Supabase Auth magic link redirect after an invited employee clicks their invitation email, provides their name, and sets their password.

**Flow:**
1. The invitee's browser lands at `${APP_URL}/accept-invite#access_token=...&type=invite` (Supabase's admin `inviteUserByEmail` uses the implicit flow — tokens arrive in the URL hash, not as a PKCE `?code=` query param). The page manually parses the hash and calls `supabase.auth.setSession()` because `@supabase/ssr`'s `createBrowserClient` defaults to `flowType: 'pkce'` and ignores hash fragments.
2. Ask the invitee to enter their full name AND choose a password. Both are required. The display name is required because `employee_directory` consumers (e.g. the AddMember picker) filter out null-name entries — without a name here, newly-active users are invisible in pickers after acceptance.
3. On submit, in order:
   a. `UPDATE public.profiles SET display_name = ? WHERE id = auth.uid()` (authorized by `profiles_update_own` RLS + column-level `GRANT UPDATE (display_name)`). Runs first — idempotent, no auth-side effect on failure.
   b. `supabase.auth.updateUser({ password })` — sets the password.
   c. `useActivateInvitedEmployee().mutate()` — flips status pending → active.
   d. `supabase.auth.refreshSession()` — reissues the JWT so `custom_access_token_hook` reads the now-active status. Without this, middleware would still see `status='pending'` and redirect to `/login?error=pending`.
   e. `router.replace('/kanban')`.
4. On error with `result.error.code === 'FORBIDDEN'` and the message about "deactivated": show an error page — "Your account has been deactivated. Contact your administrator."
5. On any other error: show a retry prompt that retries **only** the failing step (do not re-prompt for the password if it was already saved).

**Middleware note:** `/accept-invite` is in both `PUBLIC_PATHS` (so the browser can load the page and process the hash before a session cookie exists) and `PENDING_ALLOWED_PATHS` (so `status='pending'` sessions can stay on the page after the hash is processed). There is no `/api/auth/invite-callback` route — invites bypass the PKCE callback entirely.

### 3. Employee picker update (task assignment / team member addition)

**Use `useEmployeeDirectory()`** — returns `Employee[]` with `id, displayName, role`.

Do NOT use `useEmployees()` or query profiles directly.

The directory view:
- Is already scoped to the caller's company (JWT claim — no `companyId` filter needed).
- Deactivated employees are correctly excluded at the view layer (`WHERE status != 'deactivated'`).

**Pending employees ARE included in the directory.** The `employee_directory` view filters `status != 'deactivated'` only. Pending employees have `displayName = null` because they have not completed the accept-invite form yet. The frontend MUST apply a client-side filter in pickers to exclude them:

```ts
employees.filter(e => e.displayName !== null)
```

After the accept-invite form is completed, `display_name` is populated (the form makes the field required — see route section above), so newly-active users appear in pickers as soon as the caller's `useEmployeeDirectory()` cache refetches.

Deactivated employees are correctly excluded at the view layer.

### 4. Middleware error pages

The middleware now redirects to:
- `/login?error=deactivated` — for deactivated users attempting to access the app.
- `/login?error=pending` — for pending users accessing non-invite routes (defensive only).

The login page needs to read the `error` query parameter and display appropriate messages:
- `error=deactivated`: "Your account has been deactivated. Please contact your administrator."
- `error=pending`: "Your invitation is pending. Please check your email to complete account setup."

---

## Breaking Changes

None to the existing Teams or Auth frontend code.

---

## Integration Examples

### Invite an employee

```tsx
const invite = useInviteEmployee();

async function handleSubmit(email: string) {
  const result = await invite.mutateAsync({ email });
  if (!result.success) {
    if (result.error.code === 'CONFLICT') {
      // "An invitation has already been sent to this email address."
      // or "This email address belongs to an existing employee in your company."
      showError(result.error.message);
    } else {
      showError(result.error.message);
    }
    return;
  }
  showSuccess('Invitation sent!');
}
```

### Deactivate an employee

```tsx
const deactivate = useDeactivateEmployee();

async function handleDeactivate(profileId: string) {
  const result = await deactivate.mutateAsync({ targetProfileId: profileId });
  if (!result.success) {
    showError(result.error.message);
    // UNKNOWN_ERROR with partial deactivation message means DB succeeded
    // but Auth ban failed — the user will be blocked within 1 hour.
    return;
  }
  showSuccess('Employee deactivated.');
}
```

### Accept invite callback page

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActivateInvitedEmployee } from '@/features/employees/hooks/useActivateInvitedEmployee';

export default function AcceptInvitePage() {
  const activate = useActivateInvitedEmployee();
  const router = useRouter();

  useEffect(() => {
    activate.mutate(undefined, {
      onSuccess: (result) => {
        if (result.success) {
          router.replace('/kanban');
        } else {
          // Handle error — show message based on result.error.code
        }
      },
    });
  }, []); // Run once on mount

  if (activate.isPending) return <p>Setting up your account...</p>;
  // ... render error state if needed
}
```

---

## Known Limitations

1. **No invite revocation in MVP.** Pending employees remain in the admin list indefinitely unless manually deleted via the Supabase dashboard (`auth.admin.deleteUser`). Post-MVP feature.

2. **JWT staleness after deactivation.** If the Auth ban step failed (partial deactivation), the user may remain logged in for up to 1 hour until their JWT refreshes. Middleware will then catch `status='deactivated'` and block them. The admin is shown a message about this.

3. **Role change not immediately visible to the affected user.** The affected user must sign out and back in (or wait for JWT refresh) to see their new role reflected in the app. This is documented behavior (PRD FR-03).

4. **`admin_employee_list` company scope.** The view is not pre-filtered by company — the Server Action applies `WHERE company_id = callerCompanyId`. Platform admins in a future multi-company MVP would query without this filter; revisit then.

5. **`displayName` null for pending employees.** The invite-created profile has `displayName = null`. Fall back to `email` for display in the admin list. The directory view excludes this concern (picker uses displayName for selection UI).

---

## Open Questions for Product

1. Should pending employees (status='pending') appear in the employee picker (task assignment, team member addition)? The directory view includes them (`status != 'deactivated'`). They have no display name. If they should be excluded, add a client-side filter.

2. Deactivation confirmation dialog: the PRD says "prominent" — should this include the exact wording "This user will lose login access immediately" or something softer?

3. Should the admin list default-sort by status (active first, then pending, then deactivated) or strictly alphabetical? Current implementation is alphabetical by `display_name`.
