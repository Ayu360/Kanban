---
name: Kanban Platform Architecture
description: Key architectural decisions, conventions, and patterns for the work management platform — essential context for any DB or auth review
type: project
---

Multi-tenant SaaS work management platform (teams, boards, tasks). MVP is single-company but designed for N companies from day one.

**Why:** ADR-0006 mandates `company_id` on every business table from the start to avoid costly multi-tenancy retrofits.

**Key patterns:**
- RLS is the sole authorization enforcement layer (ADR-0003). Frontend checks are UX-only.
- Two-tier admin: `profiles.role` (company-scoped: admin/employee) + `profiles.is_platform_admin` (platform-scoped boolean). Orthogonal. ADR-0008.
- JWT carries `company_id`, `is_platform_admin`, `role` in `app_metadata` via a custom_access_token hook (migration 20260802000002). RLS reads from JWT, not the table.
- First-user-wins bootstrap: if `profiles` is empty on signup, promote to platform admin + company admin. Implemented as a SECURITY DEFINER PL/pgSQL function with an advisory lock. ADR-0014.
- Server Actions for privileged ops (invites, role changes, provisioning). ADR-0015.
- Repository pattern with swap seam (ADR-0004): only repositories touch Supabase; interfaces are feature-scoped.
- Fixed default company UUID: `00000000-0000-0000-0000-000000000001`.

**How to apply:** When reviewing any DB migration, check: company_id present and NOT NULL, RLS enabled with correct platform-admin bypass, JWT claim keys match hook injection (`app_metadata.company_id`, `app_metadata.is_platform_admin`, `app_metadata.role`), SECURITY DEFINER functions have `SET search_path = public`.

**Frontend Auth module review notes (2026-08-09):**
- All prior backend-flagged issues (broken build, missing authSlice imports, legacy getFakeUsers) are RESOLVED. `tsc --noEmit` exits 0.
- Legacy cleanup is complete: authSlice removed from Redux store, no `state.auth` reads, no localStorage auth, no AuthHydration, no `useEffect` auth-guard redirects (ADR-0011 satisfied).
- All auth forms use `useTransition` for pending state, `disabled={isPending}` on submit buttons, `role="alert"` on errors, and correct `autoComplete` hints.
- No direct Supabase auth calls in any client component; all mutations go through Server Actions.
- No server-only imports (supabase/server, env.server, container) in any "use client" file.
- Query invalidation on `authQueryKeys.profile` present after signIn and signUp success; sign-out is form action (no invalidation needed).
- `router.push(result.data.redirectTo)` after login: `redirectTo` value is server-validated by `isSafeRedirectPath()` — open redirect risk is mitigated at the action level.

**Frontend Auth medium-fix follow-up (2026-08-09):**
- M-1 (Suspense boundary for useSearchParams): RESOLVED. `LoginForm` inner component wraps `useSearchParams()`, `LoginPage` default export renders `<Suspense fallback={...}><LoginForm /></Suspense>`. Fallback matches full-screen layout, no layout shift. Both components in same file under single `"use client"` directive — correct per Next.js module boundary rules.
- M-2 (password min-length on confirm page): RESOLVED. `handleSubmit` in confirm/page.tsx runs `password.length < 8` check at line 43 before mismatch check at line 49. Error text exactly matches signup. `aria-describedby` toggles `password-error` / `password-hint`. `role="alert"` on inline error. `updatePasswordAction` not called on early return.
- Open Low findings (Escape key, metadata, unused React import, autoComplete on confirmPassword) remain unresolved — correctly out of scope for this fix.
- NOTE: The `src/app/(auth)/` directory and several other files (`kanban/page.tsx`, `page.tsx`, `KanbanHeader.tsx`, `index.tsx`) are NOT yet committed to git. They exist as untracked/modified working tree changes. The branch `feat/backend-auth-foundation` only has the backend auth commit (f80ad8e). Frontend work needs to be committed.
