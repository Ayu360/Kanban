---
name: Auth Migration Project Context
description: Context on the auth migration from fake auth to Supabase Auth — what was done, what's still pending, and load-bearing constraints
type: project
---

The fake-auth-to-Supabase-Auth migration (ADR-0012) is complete for the auth layer. Completed as of 2026-08-09.

**Why:** PRD 01-authentication.md required removing all fake auth (authSlice, getFakeUsers, AuthHydration) as part of the same PR that introduced real Supabase Auth. No dual-path period allowed.

**What was done (PRD 01, 2026-08-09):**
- `src/app/page.tsx` — Server Component, redirects to /kanban
- `src/app/kanban/page.tsx` — bare wrapper, no auth guard (middleware handles it)
- `src/app/login/page.tsx` — real signInAction form
- `src/features/kanban/index.tsx` — useCurrentUser() replaces state.auth.currentUser
- `src/features/kanban/components/KanbanHeader.tsx` — signOutAction + useCurrentUser()
- New pages: /signup, /reset-password, /reset-password/confirm (under src/app/(auth)/ route group)

**PRD 04 Tasks module — fake API excision (2026-08-21):**
- `src/lib/fakeApi.ts` — DELETED
- `src/api/board.ts` — DELETED
- `src/api/` directory — DELETED (became empty)
- `src/features/kanban/` — fully rewired to real TanStack Query hooks from `src/features/tasks/hooks/`
- `src/app/kanban/page.tsx` — replaced with a redirect to /teams/[teamId]/board (first team)
- New canonical board route: `src/app/teams/[teamId]/board/page.tsx`

**How to apply:** Board data is now fully wired to Supabase via TasksService/SupabaseTasksRepository. No fake API remains. The KanbanDashBoard component now requires a `boardId` prop and does not fetch the board by userId.
