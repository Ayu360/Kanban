# ADR 0011: App Router Middleware for Session Enforcement

**Status:** Accepted — 2026-08-02

## Context

The current demo enforces route protection with client-side `useEffect` hooks that redirect unauthenticated users. This has three problems:

1. **Flash of protected content** before the redirect fires.
2. **Bypassable** with browser devtools or by disabling JavaScript.
3. **Depends on Redux `authSlice` rehydration** (`AuthHydration.tsx`) which is itself client-side.

With Supabase Auth (ADR-0007) using cookie-based sessions, the server can know whether a request is authenticated before rendering.

## Decision

Use **Next.js middleware** (`src/app/middleware.ts` or `src/middleware.ts`) as the single point of session enforcement:

- On every request to a protected route, middleware reads the Supabase session from cookies using `@supabase/ssr` helpers.
- Unauthenticated requests are redirected to `/login` server-side before any page renders.
- Middleware also refreshes the session cookie when needed.
- Protected route patterns are defined by a `matcher` config in the middleware file.

Client-side `useEffect` redirects for auth are removed. `AuthHydration.tsx` is removed (see ADR-0012).

Route-level authorization (is this user allowed on this page?) beyond "logged in vs not" is layered on top:
- Server Components check the session and profile server-side and render a "not permitted" state if needed.
- The database still enforces access via RLS (ADR-0003) — the middleware and Server Component checks are UX layers, not the security boundary.

## Consequences

- **Positive:** No flash of protected content. Redirects happen before render.
- **Positive:** JavaScript-disabled or scripted clients cannot bypass auth to see protected UI.
- **Positive:** Session refresh is centralized in one place.
- **Negative:** Middleware runs on every matched request; must stay fast. Standard.
- **Negative:** Requires careful matcher configuration to avoid running on public routes and static assets.

## Alternatives considered

- **Keep client-side redirects.** Rejected: bypassable and produces flashing UX.
- **Per-page server-side session checks (no middleware).** Rejected: duplicates the check in every protected page; easy to forget on a new page.
- **API route wrapper (`withAuth`).** Not sufficient on its own — page rendering also needs protection. Middleware covers both.
