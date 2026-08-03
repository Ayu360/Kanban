# PRD Index — Work Management Platform MVP

This directory contains the four Product Requirements Documents (PRDs) for the MVP feature modules. Each PRD is implementation-ready: it describes what to build, the business rules that govern it, the backend and database shape, and measurable acceptance criteria. Each PRD maps directly to one feature slice under `src/features/`.

---

## Recommended Implementation Order

The modules have a strict dependency graph. Implement them in the order listed below.

```
01-authentication  (foundational — no upstream dependencies)
       |
       +-- 02-teams (depends on auth)
       |
       +-- 03-employees (depends on auth; parallel with teams, but member picker needs employees layer)
       |
       +-- 04-tasks (depends on auth + teams + employees)
```

### 1. Authentication (`01-authentication.md`)

Start here. Every other module depends on a live Supabase session, the `profiles` table, and the `useCurrentUser()` hook. This PR also removes all fake auth artifacts (`authSlice`, `AuthHydration.tsx`, fake user records) in a clean cutover.

Nothing else can be started until this is merged and the database migration for `companies` and `profiles` is deployed.

### 2. Teams (`02-teams.md`)

Implement next. Teams establishes the `teams`, `team_members`, `boards`, and `columns` tables, the one-board-per-team invariant, and the team-membership access model that all task visibility depends on.

The Employees module is not required to begin work on Teams. However, the "add team member" picker in the Teams UI requires active employee data, so the two modules should be coordinated toward the end of their respective implementations.

### 3. Employees (`03-employees.md`)

Can begin in parallel with Teams immediately after Authentication is merged. The Employees module operates on `profiles` (already created by Authentication) and adds invite, role change, and deactivation flows.

Employees must be merged before Tasks, because the task assignee picker depends on the employee data layer.

### 4. Tasks (`04-tasks.md`)

Implement last. This module replaces the fake API, wires the existing Kanban UI to real Supabase data, and deletes `src/lib/fakeApi.ts` and `src/api/board.ts`. It requires `boards` and `columns` rows (from Teams) and the employee directory (from Employees) to be functional.

---

## Dependency Graph (summary)

| Module | Depends on |
|---|---|
| 01-authentication | Nothing in this feature set |
| 02-teams | 01-authentication |
| 03-employees | 01-authentication |
| 04-tasks | 01-authentication, 02-teams, 03-employees |

---

## PRD Documents

| File | Feature | Key scope |
|---|---|---|
| [01-authentication.md](01-authentication.md) | Authentication | Signup, login, logout, password reset, middleware route protection, first-user-wins bootstrap, fake auth cleanup |
| [02-teams.md](02-teams.md) | Teams | Team CRUD, team membership management, one-board-per-team auto-creation, RLS team-scoped access |
| [03-employees.md](03-employees.md) | Employees | Employee list, email invitation, role promotion/demotion, deactivation, employee directory |
| [04-tasks.md](04-tasks.md) | Tasks | Real Supabase-backed Kanban board, task CRUD, drag-and-drop move, priority/assignee/due date fields, fake API deletion |

---

## Architectural Constraints Shared Across All PRDs

All PRDs apply these architectural decisions. They are not re-debated in individual PRDs — they are referenced and applied.

- **ADR-0003:** RLS is the authorization boundary. Frontend checks are UX only.
- **ADR-0004:** Repository interface per feature. `Supabase*Repository` is one implementation. Components never import the Supabase client directly.
- **ADR-0005:** TanStack Query owns server state. Redux owns UI state only.
- **ADR-0006:** `company_id NOT NULL` on every business table. Seed one default company. No multi-tenancy UI in MVP.
- **ADR-0007:** Auth session in Supabase cookies. Role in `profiles.role`. No role data in Redux.
- **ADR-0008:** `is_platform_admin` and `role = 'admin'` are orthogonal flags. Either alone grants its respective level of access.
- **ADR-0009:** Team permissions via `team_members` + RLS three-tier policy.
- **ADR-0011:** Next.js middleware is the single session enforcement point. No client-side `useEffect` redirects.
- **ADR-0013:** Query keys follow `[feature, entity, scope, params]`. Optimistic updates follow the `useMoveTopic` pattern from `src/api/board.ts`.
- **ADR-0014:** First-user-wins bootstrap for platform admin.
- **ADR-0015:** Server Actions for privileged operations. Client-side Supabase for reads and simple writes.
