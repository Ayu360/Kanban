# Project Context: Work Management Platform

Master architecture document. Last updated: 2026-08-02.

---

## 1. Purpose and Audience

This document is the single source of architectural truth for the project. It describes the target architecture for evolving the current Kanban demo into a production-ready **Work Management Platform**.

**Audience:**
- Engineers implementing features (frontend, backend, database).
- Reviewers evaluating whether a proposed change fits the architecture.
- Future contributors (human or AI) who need to understand *why* the system is shaped the way it is.

Read this document before proposing any structural change. Individual decisions and their trade-offs are recorded as ADRs under `docs/adr/`.

---

## 2. Product Vision

The product is a team-based work management tool: companies organize into teams, teams own boards, boards contain columns of tasks, and tasks are assigned to employees.

**Scope stages:**
- **MVP:** Single company. One default company row is seeded. Every user, team, board, and task belongs to that company. UI exposes no company-switching concept.
- **Post-MVP:** Multiple companies. New companies can be provisioned; users are scoped to their own company; a platform admin exists above all companies.

**Guiding principle:** *Build for one company. Design for many companies.*

This principle drives every schema, query, API, and access-control decision below. It is cheaper to carry `company_id` from day one than to retrofit it after data has accumulated.

---

## 3. System Overview

```
Browser (React 19 + TanStack Query + Redux UI state)
   |
   v
Next.js App Router (Server Components, Server Actions, Middleware)
   |
   v
Repository Layer (feature-scoped interfaces, TypeScript)
   |
   v
Supabase (Postgres + Auth + RLS)   <-- swappable
```

**Concern placement:**

| Concern | Location |
|---|---|
| Rendering, layout, presentation | React components (Server or Client) |
| Auth session (cookies, refresh) | Next middleware + Supabase SSR helpers |
| Server data fetching and caching | TanStack Query hooks in `features/<feature>/hooks/` |
| UI state (modals, filters, theme) | Redux Toolkit slices in `src/store/` |
| Business rules / orchestration | Service functions in `features/<feature>/services/` |
| Data access (SQL, Supabase calls) | Repository classes in `features/<feature>/repositories/` |
| Persistence, integrity, authorization | Postgres tables + RLS policies (in `supabase/migrations/`) |

---

## 4. Layering Model

Six layers, top-to-bottom. Each layer may only depend on layers below it.

| Layer | Responsibility | Depends on |
|---|---|---|
| **UI** | Presentation. JSX, styles, DOM events. No fetch calls, no business rules. | UI-state, server-state hooks |
| **UI State** | Ephemeral client state: modal open/closed, active filter, drag preview. Redux slices. | (none) |
| **Server State** | Cache and synchronization of remote data. TanStack Query hooks. Calls services or repositories. | Domain service |
| **Domain Service** | Orchestrates business operations: "assign task", "invite employee". Enforces invariants, composes repository calls, may call Server Actions. | Data access |
| **Data Access (Repository)** | The only layer that speaks to Supabase. Implements a feature-scoped interface. | Supabase client |
| **Database** | Postgres schema, constraints, RLS. The final line of authorization. | (none) |

**Rule:** UI components import hooks, not repositories. Hooks import services, not the Supabase client. Only repositories touch Supabase. This is what makes the backend swappable (see section 6).

---

## 5. State Ownership Rules

| State | Owner | Why |
|---|---|---|
| Auth session (user, tokens) | Supabase Auth (cookies) + a thin selector | Session is server-verified; do not duplicate in Redux |
| Current user profile (`profiles` row) | TanStack Query (`['auth', 'profile']`) | It is server data; treat as such |
| Task list, board data, teams | TanStack Query | Server data, cacheable, invalidatable |
| Active modal, form draft, filter chips | Redux Toolkit slice | Pure UI, no server round-trip |
| Theme, sidebar collapsed | Redux Toolkit slice (persisted) | UI preference |
| Drag preview during DnD | Local component state or Redux (whichever is simpler) | Ephemeral |

**Forbidden:** Never mirror server data in Redux. Never do network I/O in a Redux thunk. Server state has exactly one owner: TanStack Query.

---

## 6. The Swap Seam (Backend Portability)

**This is the load-bearing section of the document.** The architecture is designed so that Supabase can be replaced by a custom Node.js / AWS backend later with minimal frontend impact.

### The seam

Every feature defines a **Repository interface** describing the operations it needs. UI hooks depend on the *interface*, not on any concrete implementation.

```
features/tasks/
  repositories/
    TasksRepository.ts          <-- interface (the seam)
    SupabaseTasksRepository.ts  <-- current implementation
    (future) NodeTasksRepository.ts  <-- future implementation
  services/
    taskService.ts              <-- business rules, depends on TasksRepository
  hooks/
    useTasks.ts                 <-- TanStack Query, depends on taskService
  components/
    TaskCard.tsx                <-- presentation only
```

Illustrative shape (not implementation):

```
interface TasksRepository {
  listByBoard(boardId): Promise<Task[]>
  create(input): Promise<Task>
  move(id, toColumn, toIndex): Promise<Task>
  ...
}
```

A single composition-root module (e.g. `src/lib/container.ts`) selects the concrete implementation based on env config. Nothing above the repository layer knows which backend is in use.

### Dependency direction

```
Components  ->  Hooks  ->  Services  ->  Repository Interface
                                              ^
                                              |
                             (concrete impl injected at boot)
                             SupabaseTasksRepository   |   NodeTasksRepository
```

### What this buys us

- Swapping backends is a change to repository implementations and the composition root only.
- Repository interfaces are testable via contract tests (see section 15) — the same suite validates both the Supabase and future Node implementations.
- Supabase-specific types (e.g. `PostgrestError`) never appear above the repository layer. Errors are normalized to a project-defined error type.

### What this does *not* mean

- We do not build the Node backend now. We only preserve the *option* to.
- Real-time subscriptions, if used, are exposed through the repository interface as an abstract "subscribe" method — not by leaking Supabase channels into components.

See ADR-0004 for the full rationale.

---

## 7. Authentication and Authorization

### Authentication

- **Provider:** Supabase Auth, email + password for MVP.
- **Session transport:** HTTP-only cookies via `@supabase/ssr` helpers.
- **Session enforcement:** Next.js middleware validates the session on every request to a protected route. No more client-only `useEffect` redirects (see ADR-0011).

### Authorization: two-tier admin model

Two orthogonal admin concepts. They are separate columns on `profiles` and answer different questions.

| Flag | Question it answers | Scope | Set at |
|---|---|---|---|
| `profiles.role = 'admin'` | Can this user manage *their own company*? | Company-scoped | Signup / invite |
| `profiles.is_platform_admin = true` | Can this user manage *the entire platform*? | Platform-scoped (cross-company) | First user auto-grant; future console |

**Behavior:**
- A **company admin** can manage teams, invite employees, and administer boards *within their own `company_id`*. RLS scopes them to their company.
- A **platform admin** bypasses `company_id` filters entirely. RLS grants them read/write across all companies. This is a superuser for support and provisioning.
- A user can be both (the first user is).

RLS is the boundary — see ADR-0003. Never rely on frontend checks for security.

---

## 8. Multi-Tenancy Readiness Strategy

**Strategy:** shape-now, seed-one.

- **Shape now:** Every business table has `company_id UUID NOT NULL REFERENCES companies(id)` from day one. Every RLS policy filters on it. Every query includes it (implicitly, via RLS + JWT claim).
- **Seed one:** A single row is inserted into `companies` (e.g. `id = 'default'`, name "Default Company"). All MVP users, teams, boards, and tasks reference it.
- **Migration path:** Turning on true multi-tenancy is a data-load exercise (provision new companies, invite users to them), not a schema rewrite. No table has to grow a column. No RLS policy has to be rewritten.

The `company_id` is expected to be available on the JWT (via a Postgres trigger or Supabase auth hook that copies it from `profiles` to `auth.jwt().app_metadata`). RLS policies read it from there.

See ADR-0006 for the trade-off analysis (shape-now vs. add-later).

---

## 9. Domain Model (MVP)

### Entities in prose

- **companies** — the tenant. One row seeded for MVP.
- **profiles** — extends `auth.users`. Holds `company_id`, `role` (`admin` | `employee`), `is_platform_admin`, display name.
- **teams** — groupings within a company. Own boards.
- **team_members** — join table: which profiles belong to which teams.
- **boards** — belong to a team. Contain columns. No personal boards (see ADR-0005).
- **columns** — ordered list within a board (e.g. Todo, In Progress, Done).
- **tasks** — belong to a column (and transitively to a board and team). Optionally assigned to a profile.

### Diagram

```
companies (tenant)
    |
    +-- profiles ------------------+
    |     |                        |
    |     | (is_platform_admin sits outside the tenancy tree)
    |     |
    |     +--< team_members >--+
    |                          |
    +-- teams -----------------+
          |
          +-- boards
                |
                +-- columns
                      |
                      +-- tasks --> (assignee: profiles)
```

Every box under `companies` carries `company_id NOT NULL`. `profiles.is_platform_admin` is orthogonal to the tenancy tree — a platform admin still has a `company_id` (their home company), but their permissions ignore it.

### Notes

- Conceptual only. Real DDL lives in `supabase/migrations/` (future work — see ADR-0010).
- No comments, attachments, or activity logs in MVP (section 17).

---

## 10. Folder Structure (Target)

Feature-first. Each feature is a self-contained slice.

```
src/
  app/                          Next.js App Router routes
    (auth)/login/
    (app)/board/
    (app)/teams/
    (app)/employees/
    api/                        Route handlers (rare; prefer Server Actions)
    middleware.ts               Session enforcement
  features/
    tasks/
      components/               Presentation-only React components
      hooks/                    TanStack Query hooks
      services/                 Business rules
      repositories/             TasksRepository + SupabaseTasksRepository
      types/                    Feature-local TS types
    teams/
      components/ hooks/ services/ repositories/ types/
    employees/
      components/ hooks/ services/ repositories/ types/
    auth/
      hooks/ services/
  components/
    ui/                         Shared presentational components (Button, Modal, etc.)
  hooks/                        Cross-feature hooks (if any)
  lib/
    supabase/
      browser.ts                Browser client factory
      server.ts                 Server client factory
    container.ts                Composition root: wires repositories
    env.ts                      Typed env access
    logger.ts
  store/
    index.ts
    slices/                     Redux UI-state slices
supabase/
  migrations/                   SQL migrations (future)
docs/
  PROJECT_CONTEXT.md            This file
  adr/                          Architecture Decision Records
```

`@ui/*` -> `src/components/ui/*`. `@hooks/*` -> `src/hooks/*`. These aliases exist in `tsconfig.json` but the target folders do not exist yet; they will be created as needed. `@features/*` -> `src/features/*`.

---

## 11. Next.js Patterns

- **Server Components** by default. Fetch initial data on the server via a repository call using the server Supabase client, pass as props.
- **Client Components** only when interactivity or hooks are required (`'use client'` at file top).
- **Server Actions** for privileged operations: inviting an employee, changing a role, provisioning a company, deleting a board. See ADR-0015.
- **Route Handlers** (`app/api/*/route.ts`) only for third-party webhooks or when a stable HTTP surface is required.
- **Supabase clients**: two factories — one for the browser (uses public anon key + cookie session), one for server contexts (Server Components, Server Actions, middleware). Never import the browser client in a server file, and vice versa.

---

## 12. TanStack Query Conventions

### Key naming

`[feature, entity, scope, params]` — always an array, always in this order.

Examples:
- `['tasks', 'list', { boardId }]`
- `['tasks', 'detail', { id }]`
- `['teams', 'list', { companyId }]` (companyId is implicit via RLS but useful as a cache key)
- `['auth', 'profile']`

### Invalidation

Prefer coarse invalidation over surgical cache updates unless the mutation is high-frequency.
- `queryClient.invalidateQueries({ queryKey: ['tasks'] })` after a task mutation.
- For DnD (high-frequency), use optimistic updates with rollback on error.

### Optimistic updates: template

The existing `useMoveTopic` hook in `src/api/board.ts` is the reference pattern for optimistic mutations (snapshot -> optimistic setQueryData -> onError rollback -> onSettled invalidate). New optimistic mutations should follow this shape.

Note: this hook currently calls `fakeApi` directly. When migrated, it will call `tasksService.move()` which delegates to `TasksRepository.move()`. The optimistic-update *shape* stays the same; only the underlying call changes.

### Location

Hooks live in `features/<feature>/hooks/`. One hook per operation (`useTasks`, `useCreateTask`, `useMoveTask`). Do not build god-hooks that return every operation for a feature.

---

## 13. Redux Conventions

- **UI state only.** No network I/O. No thunks that call APIs.
- **Slice per concern:** `uiSlice` (modals, sidebars), `filterSlice` (per-feature filters), `themeSlice` (persisted). Do not create one giant `appSlice`.
- **Persistence:** Only for genuinely-persistent UI preferences (theme, sidebar). Everything else is session-lived.
- **No auth slice.** The current `src/store/slices/authSlice.ts` will be deleted when Supabase Auth lands (ADR-0012). Auth session lives in cookies + Supabase; profile data lives in TanStack Query.

---

## 14. Environment, Config, Secrets

### Required env vars

| Name | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Public anon key; safe in browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS; use only in Server Actions and never in client code |

### Client factories

- `lib/supabase/browser.ts` — anon key, cookie-based session, used in Client Components and browser-side hooks.
- `lib/supabase/server.ts` — anon key by default (respects RLS); service-role variant available for privileged Server Actions only. Never imported in files marked `'use client'`.

### Environments

One Supabase project per environment: dev, staging, prod. Env vars provided via Vercel per environment.

---

## 15. Testing Strategy (Target)

| Layer | Test type | Notes |
|---|---|---|
| Repository | **Contract tests** | Same suite runs against `SupabaseTasksRepository` (integration, real DB) and future `NodeTasksRepository`. This is what makes the swap seam credible. |
| Service | Unit tests | Mock the repository interface. Test business rules and orchestration. |
| Hooks | Integration tests | Mock the service. Test cache behavior, optimistic updates, error handling. |
| Components | Component tests | Test critical flows: create task, drag task, invite employee. Snapshot tests discouraged. |
| E2E | Smoke tests | Playwright, happy paths only. |

Contract tests are the linchpin: if `NodeTasksRepository` ever gets built, it must pass the same suite before it can replace `SupabaseTasksRepository`.

---

## 16. Migration Plan: Current Demo to New Architecture

The current codebase is a client-only Kanban demo with a fake API, hard-coded users, and no persistence. This is the ordered plan to reach the target architecture. Each step is a discrete PR.

**Files referenced (current state):**
- `src/lib/fakeApi.ts` — in-memory API, all reads/writes.
- `src/api/board.ts` — TanStack hooks calling `fakeApi` directly (no repository seam).
- `src/store/slices/authSlice.ts` — Redux slice holding current user id.
- `src/app/AuthHydration.tsx` — rehydrates auth from localStorage on mount.

### Ordered steps

1. **Introduce the repository seam (no behavior change).**
   Create `features/tasks/repositories/TasksRepository.ts` (interface) and `LocalTasksRepository.ts` (wraps existing `fakeApi.ts`). Refactor `src/api/board.ts` hooks to depend on the interface via `container.ts`. Delete direct `fakeApi` imports from hooks. Tests still pass; nothing else changes. This step alone unlocks every future step.

2. **Wire Supabase Auth. Delete fake login artifacts.**
   Add Supabase client factories, `middleware.ts` for session enforcement, login/signup pages that call Supabase Auth. Delete `src/lib/fakeApi.ts` user records, `src/store/slices/authSlice.ts`, `src/app/AuthHydration.tsx`, and all references. Move current-user access to a `useCurrentUser` hook backed by Supabase + TanStack Query. Clean cutover — no dual-path period (see ADR-0006 / ADR-0012).

3. **Add DB schema and RLS (in `supabase/migrations/`).**
   Create `companies`, `profiles`, `teams`, `team_members`, `boards`, `columns`, `tasks`. Every business table has `company_id NOT NULL`. Seed one default company row. Enable RLS on every table with company-scoped policies + platform-admin bypass + team-membership filter.

4. **Replace `LocalTasksRepository` with `SupabaseTasksRepository`.**
   Implement the interface against Supabase. Delete `src/lib/fakeApi.ts`. Delete `LocalTasksRepository`. The composition root now wires the Supabase implementation. Hooks and components are unchanged.

5. **Persist "add card".**
   The current "add card" flow lives in client-only `useState` (never hits `fakeApi`). Wire it to `tasksService.create()` -> `TasksRepository.create()`. This becomes the first real end-to-end mutation.

6. **Build teams and employees features.**
   New feature slices under `features/teams/` and `features/employees/`. Server Actions for `inviteEmployee`, `changeRole`, `createTeam`, `addTeamMember` (ADR-0015).

7. **Bootstrap first admin.**
   Signup handler checks if `profiles` is empty; if so, promotes the new user to `is_platform_admin=true` and `role='admin'` of the default company (ADR-0014).

8. **Harden.**
   Contract tests for the repository. Middleware-based route protection replaces any remaining client redirects. Remove `AuthHydration` and any localStorage-based session code.

Each step is independently mergeable and leaves the app in a working state.

---

## 17. Non-Goals (Out of Scope for MVP)

- Comments on tasks
- File attachments
- Notifications (email, in-app, push)
- Cross-team search
- Activity logs / audit trail
- Reports and dashboards
- Billing / subscriptions
- Real-time collaboration cursors
- Public boards / external sharing
- Mobile apps (web-only)

These are deliberately excluded to keep the MVP shippable. Each requires its own ADR when introduced.

---

## 18. Open Architectural Questions and Their Current Answers

Ten decisions have been made and are locked in. Each has an ADR. Summary:

| # | Question | Answer | ADR |
|---|---|---|---|
| 1 | When to add `company_id`? | Day one, on every business table, NOT NULL. Seed one default company. | 0006 |
| 2 | Where does role live? | `profiles.role` (company admin/employee) + `profiles.is_platform_admin` (platform superuser). Orthogonal flags. | 0007, 0008 |
| 3 | How are team permissions enforced? | RLS filter by `team_members` membership; company admin bypass within their company; platform admin sees all. | 0009 |
| 4 | How is the first admin created? | First-user-wins: signup handler detects empty `profiles` and promotes that user. | 0014 |
| 5 | Do boards belong to users or teams? | Teams only. No personal boards. | 0005 (in this doc, section 9) |
| 6 | How do we cut over from fake login? | Clean cutover in one PR: delete `fakeApi`, `authSlice`, `AuthHydration` when Supabase Auth lands. | 0012 |
| 7 | How is Supabase deployed? | Hosted Supabase, one project per env (dev / staging / prod). | 0001 |
| 8 | What about `AI_CONTEXT.md`? | Deleted. Superseded by this document. | (this doc) |
| 9 | Where's the Server Action boundary? | Client-side Supabase for reads and simple writes; Server Actions for privileged ops (invites, role changes, provisioning). | 0015 |
| 10 | Where does SQL live in this doc? | Nowhere. Conceptual model only. Real SQL lives in `supabase/migrations/`. | (this doc) |

---

## 19. Glossary

- **Company** — a tenant. Owns users, teams, boards, tasks. Identified by `company_id`.
- **Team** — a grouping of employees within a company. Owns boards.
- **Employee** — a user with `role='employee'` in a company. Sees only boards for teams they belong to.
- **Admin (company admin)** — a user with `role='admin'` in a company. Manages teams, invites employees, administers all boards within their `company_id`.
- **Platform admin** — a user with `is_platform_admin=true`. Bypasses `company_id` filtering entirely. Used for support and provisioning.
- **Task** — a unit of work. Belongs to a column (and transitively to a board, team, company). Optionally assigned to a profile.
- **Board** — a Kanban board. Belongs to a team. Contains columns.
- **Column** — an ordered list of tasks within a board (e.g. Todo, In Progress, Done).
- **Tenant** — synonym for company. Used when discussing multi-tenancy patterns.
- **Repository** — the swappable data-access layer. One interface per feature; a concrete implementation per backend.
- **Service** — a domain-layer module that orchestrates repository calls and enforces business rules.
- **Swap seam** — the repository interface boundary that lets Supabase be replaced without frontend rewrites.
