---
name: Kanban Project Context
description: Kanban work management platform architecture, ADR conventions, auth patterns, and key engineering decisions
type: project
---

This is a production-ready Work Management Platform (single company now, multi-company SaaS later).

**Why:** Build for one company. Design for many companies. Every business table carries company_id from day one.

**Tech Stack:** Next.js App Router, React 19, TypeScript, TailwindCSS, TanStack Query, Redux (UI state only), Supabase (Auth + Postgres + RLS), Vercel deployment.

**Architecture:** Feature-first folder structure under src/features/. Six-layer model: UI → UI State → Server State (TanStack Query) → Domain Service → Data Access (Repository) → Database (Postgres + RLS).

**Auth module (completed):** SupabaseAuthRepository → AuthService → authActions (Server Actions). PKCE callback via /api/auth/callback. Session in HTTP-only cookies via @supabase/ssr. Middleware enforces all auth redirects. No client-side auth guards (ADR-0011).

**Key ADRs:**
- ADR-0003: RLS is the security boundary, frontend checks are UX only
- ADR-0004: Repository/service abstraction — swap seam (Supabase swappable)
- ADR-0011: Middleware-only session enforcement, no useEffect redirects
- ADR-0012: authSlice and AuthHydration.tsx to be deleted in auth cutover PR
- ADR-0014: First-user-wins bootstrap for platform admin
- ADR-0015: Server Actions for privileged ops (signup, signout, role changes)

**Env split (C-4 fix):** env.public.ts (NEXT_PUBLIC_ vars, browser-safe), env.server.ts (SUPABASE_SERVICE_ROLE_KEY + APP_URL, server-only guarded). Old env.ts deleted.

**container.ts:** Module-level singletons of SupabaseAuthRepository and AuthService. Safe because both are stateless (per-request Supabase clients).

**Known deferred issues (Medium/Low):** M-1 through M-7, L-1 through L-5 — tracked for follow-up PR. Frontend C-1 items are frontend team's responsibility.

**How to apply:** Use as context when reviewing any PR in this project. Auth backend is approved for frontend integration as of 2026-08-03.
