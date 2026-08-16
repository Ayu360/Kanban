---
name: Project: Employees Backend Implementation
description: Employees module backend complete; types, repo, service, server actions, hooks, container wiring, middleware update, and frontend handoff all done
type: project
---

Employees module backend is complete on branch `f/foundation-employees-module`.

**Why:** DB layer (migration 20260816000002) added status/deactivated_at columns, two views (employee_directory, admin_employee_list), four SECURITY DEFINER RPCs, and JWT hook update. Backend integration against this fixed DB contract.

**Key decisions made:**
- RPCs called via service-role so DB auth.uid() returns null; service layer is sole authz enforcer (same as Teams addMember/delete pattern).
- activate_invited_employee uses authenticated (anon) client — the one exception, because it MUST have a real user session for auth.uid().
- Two-step deactivate (DB first, Auth ban trailing) with no automatic rollback on Auth ban failure — deactivated-in-DB is the correct persistent state.
- Two-step reactivate (DB first, Auth unban trailing) WITH compensating rollback if Auth unban fails.
- Middleware extended with status claim checks: deactivated → signOut + redirect /login?error=deactivated; pending on non-invite-routes → redirect /login?error=pending.
- PENDING_ALLOWED_PATHS = {'/api/auth/invite-callback', '/accept-invite'} — these are the only routes pending users may access.
- admin_employee_list view is NOT company-scoped in the DB; WHERE company_id = callerCompanyId applied in repository.

**Files produced:**
- src/features/employees/types/index.ts
- src/features/employees/repositories/EmployeesRepository.ts (interface)
- src/features/employees/repositories/SupabaseEmployeesRepository.ts
- src/features/employees/services/employeesService.ts
- src/features/employees/services/employeesActions.ts
- src/features/employees/hooks/useEmployees.ts (+ employeesQueryKeys factory)
- src/features/employees/hooks/useEmployee.ts
- src/features/employees/hooks/useEmployeeDirectory.ts
- src/features/employees/hooks/useInviteEmployee.ts
- src/features/employees/hooks/useChangeEmployeeRole.ts
- src/features/employees/hooks/useDeactivateEmployee.ts
- src/features/employees/hooks/useReactivateEmployee.ts
- src/features/employees/hooks/useActivateInvitedEmployee.ts
- src/lib/container.ts (getEmployeesService added)
- src/middleware.ts (status claim checks added)
- docs/handoffs/backend-to-frontend-employees.md

**How to apply:** When working on employees-adjacent features (tasks, team member picker), use useEmployeeDirectory() not useEmployees() for non-admin reads. Directory view auto-scopes by company and excludes deactivated employees.
