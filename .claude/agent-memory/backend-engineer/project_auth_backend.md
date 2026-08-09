---
name: Auth Backend Implementation Status
description: Auth backend complete with code-review fixes applied. Frontend handoff doc created. 4 frontend files still need updates before TypeScript build passes.
type: project
---

Auth backend was implemented 2026-08-03. A code review pass was applied on the same date fixing: PKCE callback route, session after signup, env module split, middleware guards, APP_URL validation, error code mapping, and uniform sign-in error messages.

**Why:** The first implementation passed review for architecture but had 7 functional/security findings (C-2 through H-4) that needed fixing before the frontend could wire against the backend safely.

**How to apply:** The backend layer is now clean. When asked about TypeScript errors or the build state, note that these 4 UI files need frontend updates (see handoff doc at docs/handoffs/backend-to-frontend-authentication.md):
- `src/app/page.tsx` — Redux auth guard needs removal
- `src/app/login/page.tsx` — fake user picker needs real login form
- `src/app/kanban/page.tsx` — Redux redirect guard needs removal
- `src/features/kanban/components/KanbanHeader.tsx` — needs useCurrentUser() + signOutAction

**Key backend files and their state after the review pass:**

- `src/lib/env.public.ts` — NEW. Public env vars only (SUPABASE_URL, SUPABASE_ANON_KEY). No server-only guard. Safe for browser import.
- `src/lib/env.server.ts` — NEW. Server-only env vars (SUPABASE_SERVICE_ROLE_KEY, APP_URL). Guarded by `import 'server-only'`.
- `src/lib/env.ts` — DELETED. Replaced by the split above.
- `src/lib/supabase/browser.ts` — imports from env.public.ts (was env.ts).
- `src/lib/supabase/server.ts` — imports from env.public.ts + env.server.ts. Has `import 'server-only'`.
- `src/lib/container.ts` — has `import 'server-only'` added.
- `src/middleware.ts` — H-1 fail-fast guard added; no-null-assertions replaced with validated consts; `/api/auth/callback` added to PUBLIC_PATHS.
- `src/features/auth/repositories/SupabaseAuthRepository.ts` — mapAuthError now prefers error.code/error.status over message strings; sendPasswordResetEmail redirectTo now points to /api/auth/callback?next=/reset-password/confirm using validated APP_URL.
- `src/features/auth/services/authService.ts` — signUp now calls repo.signIn() after profile creation to establish session cookie (C-3 fix, Approach A).
- `src/features/auth/services/authActions.ts` — signInAction now returns uniform generic message for ALL failures (not just invalid-credentials).
- `src/app/api/auth/callback/route.ts` — NEW. PKCE code exchange route handler.
- `docs/handoffs/backend-to-frontend-authentication.md` — NEW. Full handoff doc for frontend engineer.

DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001' (seeded in migration 20260802000001)
create_profile_for_user RPC must be called with service-role client only.
APP_URL env var: set NEXT_PUBLIC_APP_URL in .env.local (consumed as APP_URL server-side from env.server.ts).
