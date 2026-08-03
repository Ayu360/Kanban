# Architecture Decision Records

This directory contains ADRs for the Work Management Platform. Each ADR captures one decision, why it was made, what alternatives were considered, and what consequences it carries.

**Format:** Status / Context / Decision / Consequences / Alternatives considered.

**All decisions below:** Accepted, 2026-08-02.

## Index

| # | Title | Summary |
|---|---|---|
| [0001](0001-use-supabase-for-mvp-backend.md) | Use Supabase for the MVP backend | Hosted Supabase (Postgres + Auth + RLS + Storage) is the MVP backend; one project per env. |
| [0002](0002-postgres-as-long-term-database.md) | Postgres as the long-term database | Postgres is the permanent database; no NoSQL for core business data ever. |
| [0003](0003-rls-is-the-authorization-boundary.md) | RLS is the authorization boundary | Row-Level Security enforces access control at the database. Frontend checks are UX only. |
| [0004](0004-repository-service-abstraction-swap-seam.md) | Repository + service abstraction (the swap seam) | Feature-scoped repository interfaces isolate Supabase; enables future backend swap. Load-bearing. |
| [0005](0005-tanstack-query-server-state-redux-ui-state.md) | TanStack Query for server state, Redux for UI state | Strict separation: no server data in Redux, no network I/O in Redux. |
| [0006](0006-multi-tenancy-company-id-from-day-one.md) | `company_id` on every business table from day one | Shape-now over add-later. Seed one default company. Load-bearing. |
| [0007](0007-supabase-auth-with-role-in-profiles.md) | Supabase Auth with role in `profiles` | Session in Supabase Auth; app role (`admin`/`employee`) in `profiles.role`. |
| [0008](0008-two-tier-admin-platform-vs-company.md) | Two-tier admin: platform vs company | `is_platform_admin` and `role='admin'` are orthogonal flags with different scopes. |
| [0009](0009-team-permissions-via-team-members-and-rls.md) | Team permissions via `team_members` + RLS | Row-level filter by team membership; company admin bypass; platform admin sees all. |
| [0010](0010-feature-first-folder-structure.md) | Feature-first folder structure | Slices under `features/<feature>/{components,hooks,services,repositories,types}`. |
| [0011](0011-app-router-middleware-session-enforcement.md) | App Router middleware for session enforcement | Next middleware validates sessions on protected routes; no more client-only redirects. |
| [0012](0012-retire-redux-auth-slice-on-supabase-auth.md) | Retire Redux `authSlice` when Supabase Auth lands | Delete `authSlice.ts` and `AuthHydration.tsx` in one clean cutover PR. |
| [0013](0013-query-key-conventions-and-invalidation.md) | Query key conventions and invalidation | `[feature, entity, scope, params]`; coarse invalidation by default; optimistic per template. |
| [0014](0014-first-user-wins-platform-admin-bootstrap.md) | First-user-wins platform admin bootstrap | If `profiles` is empty on signup, promote to platform admin + company admin. |
| [0015](0015-server-actions-for-privileged-ops.md) | Server Actions for privileged operations | Reads and simple writes client-side; invites, role changes, provisioning via Server Actions. |
