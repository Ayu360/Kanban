---
name: Auth Migration Project Context
description: Context on the auth migration from fake auth to Supabase Auth — what was done, what's still pending, and load-bearing constraints
type: project
---

The fake-auth-to-Supabase-Auth migration (ADR-0012) is complete for the auth layer. Completed as of 2026-08-09.

**Why:** PRD 01-authentication.md required removing all fake auth (authSlice, getFakeUsers, AuthHydration) as part of the same PR that introduced real Supabase Auth. No dual-path period allowed.

**What was done:**
- `src/app/page.tsx` — Server Component, redirects to /kanban
- `src/app/kanban/page.tsx` — bare wrapper, no auth guard (middleware handles it)
- `src/app/login/page.tsx` — real signInAction form
- `src/features/kanban/index.tsx` — useCurrentUser() replaces state.auth.currentUser
- `src/features/kanban/components/KanbanHeader.tsx` — signOutAction + useCurrentUser()
- New pages: /signup, /reset-password, /reset-password/confirm (under src/app/(auth)/ route group)

**Still pending (separate PR):**
- Board/column/task data still uses fakeApi (src/lib/fakeApi.ts, src/api/board.ts). Migration to SupabaseBoardRepository is migration step 4 in PROJECT_CONTEXT.md.

**How to apply:** When touching KanbanDashBoard or board hooks, expect fakeApi to still be in use for board data. Auth is real; board data is fake.
