# Authentication — Product Requirements Document

---

# Overview

The Authentication module replaces the current client-only fake login scaffolding with real, production-grade authentication backed by Supabase Auth. It covers email/password signup and login, cookie-based session management, server-enforced route protection via Next.js middleware, password reset, and the first-user-wins bootstrap that promotes the very first signup to platform admin and company admin of the default company.

This module is the foundational layer on which every other feature is built. No other feature may be implemented until this one is complete and merged.

---

# Goals

1. Users can create accounts with an email address and password and immediately access the application.
2. Authenticated sessions are held in HTTP-only cookies and validated server-side on every request to a protected route — no client-side-only auth checks.
3. The first user to sign up on a fresh database is automatically granted platform-admin and company-admin status with no manual step required.
4. All fake auth artifacts (`authSlice`, `AuthHydration.tsx`, fake user records in `fakeApi.ts`) are removed in the same PR that introduces real auth, with no dual-path period.
5. Users can reset forgotten passwords via email.
6. The current user's profile data is accessible throughout the application via a `useCurrentUser` hook backed by TanStack Query.

---

# Non Goals

- Magic link / passwordless authentication (post-MVP).
- OAuth / social login (Google, GitHub, etc.) — post-MVP.
- Multi-factor authentication — post-MVP.
- Company provisioning UI — the default company row is seeded in the migration; no UI is needed for MVP.
- Platform admin management UI — the flag exists and the bootstrap sets it, but a dedicated admin console is post-MVP.
- Session management UI (active sessions list, remote sign-out) — post-MVP.

---

# User Stories

1. As a new user, I can sign up with my email address and a password so that I can access the application.
2. As a returning user, I can log in with my email and password so that my session is restored.
3. As a logged-in user, I can log out so that my session is ended and I am returned to the login page.
4. As a user who has forgotten their password, I can request a password reset email so that I can regain access to my account.
5. As a user following a password reset link, I can set a new password so that my account is secured.
6. As an unauthenticated visitor, I am redirected to the login page when I attempt to access any protected route, and I see no flash of protected content.
7. As the very first person to sign up on a fresh installation, I automatically become the platform admin and company admin without any manual database step.
8. As any component or hook in the application, I can access the current user's profile via a single `useCurrentUser` hook and trust that it reflects the live Supabase session.

---

# Functional Requirements

## FR-01: Email/Password Signup

- The signup page (`/signup`) accepts an email address and password.
- Password minimum length: 8 characters.
- On successful signup: a `profiles` row is created, the first-user-wins check runs (see FR-06), and the user is redirected to the main application (`/kanban` or `/board`).
- On duplicate email: a user-visible error message is displayed without exposing internal error details.
- The signup flow is implemented as a Server Action (per ADR-0015) so that the first-user-wins check and profile insert run atomically on the server.

## FR-02: Email/Password Login

- The login page (`/login`) accepts an email and password.
- On success: session is established in an HTTP-only cookie and the user is redirected to the protected route they originally requested, or to the default landing page if no prior route exists.
- On invalid credentials: a generic "Invalid email or password" message is shown. The message does not distinguish between "email not found" and "wrong password."
- Failed login attempts are not rate-limited in the application layer; Supabase Auth's built-in rate limiting applies.

## FR-03: Logout

- A logout action is accessible from the main application UI (location determined by UI design).
- Logout clears the Supabase session cookie and redirects the user to `/login`.
- Logout is implemented as a Server Action.

## FR-04: Route Protection via Middleware

- `src/middleware.ts` intercepts every request before page rendering.
- Protected routes: all routes not in the public list below.
- Public routes: `/` (landing page), `/login`, `/signup`, `/how-it-works`.
- Static assets and Next.js internals (`/_next/`, `/favicon.ico`, etc.) are excluded from the matcher.
- Unauthenticated requests to protected routes are redirected to `/login?redirect=<original-path>` server-side, before any page component renders.
- On login, the user is forwarded to the original `redirect` path if present and valid; otherwise to the default post-login page.
- The middleware also calls `supabase.auth.getSession()` to refresh the session cookie on every matched request, keeping sessions alive for active users.

## FR-05: Password Reset

- A "Forgot password?" link on the login page leads to a password reset request page (`/reset-password`).
- The user enters their email. A reset email is sent via Supabase Auth's built-in password recovery flow.
- If the email does not correspond to any account, the page still shows a success message (prevents email enumeration).
- The user follows the link in the email to a confirmation page (`/reset-password/confirm`) where they enter and confirm a new password.
- On success, the new password is set and the user is redirected to `/login`.

## FR-06: First-User-Wins Bootstrap

- The Server Action handling signup performs an atomic check: if the `profiles` table has zero rows, the new profile is created with `is_platform_admin = true` and `role = 'admin'` scoped to the default company.
- If the `profiles` table already has one or more rows, the new profile is created with `is_platform_admin = false` and `role = 'employee'` scoped to the default company.
- The check-and-insert is transactional to prevent a race condition if two users sign up simultaneously into an empty database.
- The default company row is expected to be present from the database migration seed; the signup Server Action does not create it.

## FR-07: Current User Profile Access

- A `useCurrentUser()` hook (in `src/features/auth/hooks/`) returns the authenticated user's `profiles` row.
- Internally, the hook reads the Supabase session and queries the `profiles` table, with TanStack Query as the cache layer under query key `['auth', 'profile']`.
- The hook returns a typed result: `{ user: Profile | null, isLoading: boolean, error: Error | null }`.
- All components and hooks in the application that need the current user's identity or role use this hook. No component reads from `authSlice` or `localStorage` for auth state.

## FR-08: Migration — Removal of Fake Auth Artifacts

The following files and references are removed as part of this feature's PR. This is not optional and is not deferred.

- `src/store/slices/authSlice.ts` — deleted in full.
- `src/app/AuthHydration.tsx` — deleted in full. Its usage is removed from the root layout.
- All fake user records inside `src/lib/fakeApi.ts` — removed. If `fakeApi.ts` is being fully replaced in this same PR, the entire file is deleted; otherwise only the user records are removed.
- The current `src/app/login/page.tsx` fake login logic — replaced with the real Supabase login form.
- Any `localStorage` reads or writes related to auth session state — removed.
- All imports of `authSlice` or `AuthHydration` across the codebase — removed or replaced with `useCurrentUser()`.

---

# Business Rules

- Per ADR-0006, every `profiles` row carries `company_id NOT NULL` referencing the seeded default company for MVP. There is no user without a company.
- Per ADR-0007, application role (`admin` / `employee`) lives in `profiles.role`, not in Supabase Auth user metadata. `is_platform_admin` is a separate boolean on `profiles`.
- Per ADR-0008, the two admin flags are orthogonal. The first user holds both. A platform admin is not necessarily a company admin and vice versa.
- Per ADR-0014, the first-user-wins check is the sole mechanism for granting platform-admin status in the MVP. There is no admin promotion UI.
- Per ADR-0011, client-side `useEffect` redirects for auth are forbidden. The middleware is the single enforcement point.
- Per ADR-0012, the cutover from fake auth to Supabase Auth is a single, clean PR. No dual-path period, no compatibility shim.
- Per ADR-0015, signup (with the first-user-wins check) and logout are Server Actions. Login is handled by calling Supabase Auth from a Server Action or a Next.js Server Component form — not by a client-side `supabase.auth.signInWithPassword` call that bypasses the server.
- Per ADR-0003, frontend auth checks are UX only. RLS and middleware are the enforcement boundaries.
- The `company_id` and `is_platform_admin` values are propagated to the JWT via a Supabase auth hook or database trigger, so RLS policies can read them from the token without additional queries.

---

# Edge Cases

1. **Simultaneous first signup:** Two users sign up at the exact same moment on a fresh database. Only one must become platform admin. The Server Action uses a transactional check to guarantee exactly one winner.
2. **Signup with an already-registered email:** Supabase Auth returns an error. The UI displays a user-friendly message without revealing whether the email is in use.
3. **Session expiry during active use:** The middleware refreshes the session cookie on every request. If the refresh token is also expired, the user is redirected to `/login` on their next navigation.
4. **Password reset link already used or expired:** The Supabase Auth link is single-use and time-limited. The confirmation page must handle an invalid token gracefully and prompt the user to request a new reset email.
5. **User navigates directly to a protected route while logged out:** Middleware redirects to `/login?redirect=<path>`. After login, the user is forwarded to their original destination.
6. **User navigates directly to `/login` or `/signup` while already logged in:** Middleware redirects them to the default post-login page to avoid a confusing re-login screen.
7. **The default company row is missing from the database:** The signup Server Action cannot create a profile without a valid `company_id`. This is a configuration error; the Server Action must return a clear server-side error, and the migration seed must be documented as a prerequisite.
8. **`authSlice` import missed during cleanup:** A build-time TypeScript error will surface any forgotten import after the slice is deleted. The PR must not merge with TypeScript errors.

---

# UI Requirements

- The login page (`/login`) presents an email field, a password field, a submit button, a link to `/signup`, and a "Forgot password?" link.
- The signup page (`/signup`) presents an email field, a password field (with a minimum-length hint), a submit button, and a link back to `/login`.
- The password reset request page (`/reset-password`) presents an email field and a submit button. On submission it always shows a success message regardless of whether the email matched.
- The password reset confirmation page (`/reset-password/confirm`) presents a new password field and a confirm password field. Both fields must match before submission is allowed.
- All auth pages are publicly accessible and share a minimal layout (no sidebar, no nav) distinct from the main application layout.
- Inline field-level validation errors are displayed (e.g., "Password must be at least 8 characters") without requiring a round trip.
- Form submission states (loading, success, error) must be reflected in the UI — the submit button is disabled while a request is in flight.
- No fake or placeholder user identity is ever rendered in the UI after this feature lands.

---

# Backend Requirements

- `AuthRepository` interface defined in `src/features/auth/repositories/AuthRepository.ts`. Methods include at minimum: `signUp`, `signIn`, `signOut`, `resetPassword`, `updatePassword`, `getSession`, `getCurrentProfile`.
- `SupabaseAuthRepository` in `src/features/auth/repositories/SupabaseAuthRepository.ts` implements the interface using `@supabase/ssr` helpers.
- `AuthService` in `src/features/auth/services/authService.ts` contains the business logic that wraps repository calls, including the first-user-wins check logic invoked during signup.
- Server Actions in `src/features/auth/services/authActions.ts` (marked `'use server'`): `signUpAction`, `signOutAction`, `resetPasswordAction`, `updatePasswordAction`.
- The login form may call `supabase.auth.signInWithPassword` via a Server Action or a route handler; the session cookie is set on the server response.
- `src/middleware.ts` uses the server-side Supabase client factory (`src/lib/supabase/server.ts`) and the `@supabase/ssr` cookie helper to read and refresh the session.
- The composition root (`src/lib/container.ts`) wires `SupabaseAuthRepository` as the implementation for `AuthRepository`.
- Per ADR-0004, `PostgrestError` and any Supabase-specific error types are caught at the repository layer and re-thrown as a normalized project error type. No Supabase types leak into the service or hook layers.
- Per ADR-0007, `company_id` and `is_platform_admin` are synced to the JWT via a Supabase auth hook or database trigger. The implementation of that hook is part of the database migration work (see Database Requirements), but the Server Action must not assume the JWT is already populated on the very first request after signup — it should read the profile from the database when needed.

---

# Database Requirements

Described in prose only. SQL lives in `supabase/migrations/`.

- A `companies` table holds tenant rows. One row is seeded with the name "Default Company" for the MVP. It carries an `id` (UUID), `name`, and standard timestamps.
- A `profiles` table extends `auth.users`. Each row carries: `id` (same UUID as the corresponding `auth.users` row, primary key), `company_id` (UUID, non-nullable, foreign key to `companies`), `role` (text, constrained to `'admin'` or `'employee'`), `is_platform_admin` (boolean, non-nullable, defaults to false), `display_name` (text, optional), and standard timestamps.
- A database trigger or Supabase auth hook copies `company_id` and `is_platform_admin` from the `profiles` row into the JWT's `app_metadata` after every insert or update to `profiles`. This makes these values available to RLS policies via `auth.jwt()` without extra queries.
- RLS is enabled on `profiles`. Read policy: a user can read their own row; a company admin can read all profiles with the same `company_id`; a platform admin can read all profiles. Write policy for role changes and `is_platform_admin` changes: Server Action with the service-role key only.
- The `companies` table has RLS enabled. MVP policy: all authenticated users can read the default company row. Writes are service-role only.

---

# Validation Rules

- Email: must be a valid email address format. Validated client-side (UX) and relied upon from Supabase Auth server-side (enforcement).
- Password on signup: minimum 8 characters. Validated client-side and enforced by Supabase Auth's password policy configuration.
- Password on reset confirmation: the two password fields must match before the form can be submitted. Validated client-side only (since mismatched passwords cannot be meaningfully checked server-side without receiving both).
- Reset password token: validated by Supabase Auth. The confirmation page must gracefully handle an invalid or expired token.
- `role` on the `profiles` row: constrained to `'admin'` or `'employee'` by a database `CHECK` constraint.
- `company_id` on the `profiles` row: non-nullable, with a foreign key constraint. The signup Server Action must always supply a valid `company_id`.

---

# Acceptance Criteria

1. A user with no existing account can complete the signup form and land on the main application page within one redirect. A corresponding `profiles` row exists in the database with `role = 'employee'` and `is_platform_admin = false` (unless they are the first user).
2. The very first signup on a database with zero `profiles` rows results in a profile with `is_platform_admin = true` and `role = 'admin'`. All subsequent signups produce `role = 'employee'` and `is_platform_admin = false`.
3. An authenticated user who closes and reopens the browser within the session window (before cookie expiry) does not have to log in again.
4. An unauthenticated user who visits `/kanban` is redirected to `/login` server-side. The kanban page content never renders in the browser before the redirect fires.
5. A logged-in user who visits `/login` is redirected to the default post-login page without seeing the login form.
6. A user who requests a password reset receives an email. Following the link and setting a new password allows them to log in with the new password. The old password no longer works.
7. No reference to `authSlice`, `AuthHydration`, or `localStorage` auth state exists anywhere in the codebase after this feature merges. The TypeScript build completes without errors.
8. `useCurrentUser()` returns the correct `profiles` row for the logged-in user when called from any component in the application.
9. Logging out clears the session cookie. Subsequent navigation to any protected route redirects to `/login`.
10. Submitting the login form with an incorrect password shows an error message and does not redirect the user.

---

# Dependencies

- Supabase project provisioned and accessible (ADR-0001). Environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` must be set.
- `@supabase/ssr` and `@supabase/supabase-js` installed.
- Database migration creating `companies` and `profiles` tables with the seed company row must run before this feature is functional.
- The Supabase auth hook or trigger that copies `company_id` and `is_platform_admin` to the JWT must be deployed alongside the migration.
- No other MVP feature module depends on this one as a prerequisite; this module depends on nothing else in the MVP feature set.

---

# Future Enhancements

- OAuth providers (Google, GitHub).
- Magic link / passwordless login.
- Multi-factor authentication.
- Session management UI (view and revoke active sessions).
- Per-environment email templates for password reset and invite emails.
- Platform admin console for managing platform admin grants.
- Audit log for login events and privilege changes.
