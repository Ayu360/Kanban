# Backend-to-Frontend Handoff: Authentication Module

## Scope Note

This document enumerates every frontend change required for authentication integration. The backend implementation is complete. All server-side logic (repositories, services, Server Actions, middleware, API routes) is in place and ready for the frontend to wire against. No further backend changes are needed before the frontend can start.

The frontend engineer must NOT modify any backend file (`src/lib/**`, `src/features/auth/repositories/**`, `src/features/auth/services/**`, `src/middleware.ts`, `src/app/api/**`).

---

## C-1: Files the Frontend Must Fix (Broken Build)

The following frontend files still use the old fake-auth (`authSlice`, `getFakeUsers`, Redux-based redirects). They will break the TypeScript build once the real auth is in place. Each must be updated.

### `src/app/login/page.tsx`

**Current bad imports:**
```ts
import { useDispatch, useSelector } from "react-redux";
import { store } from "@/store";
import { setUser } from "@/store/slices/authSlice";
import { getFakeUsers } from "@/lib/fakeApi";
import type { User } from "@/features/kanban/types";
import type { RootState } from "@/store";
```

**What to replace with:**

Replace the entire component with a real login form. The form must:
- Have `name="email"` and `name="password"` inputs.
- Call `signInAction(formData)` from `"@/features/auth/services/authActions"` on submit.
- Read `redirectTo` from the URL query param and pass it as a hidden input named `"redirectTo"`.
- On `result.success === true`, call `router.push(result.data.redirectTo)`.
- On `result.success === false`, display `result.error.message` inline.
- Show a loading state while the action is in flight (use `useTransition` or the form action pattern).
- Include links to `/signup` and `/reset-password`.

Example minimal shape:
```ts
"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInAction } from "@/features/auth/services/authActions";
```

### `src/features/kanban/components/KanbanHeader.tsx`

**Current bad imports:**
```ts
import { setUser, clearUser } from "@/store/slices/authSlice";
import { getFakeUsers } from "@/lib/fakeApi";
import type { User } from "@/features/kanban/types";
```

**What to replace with:**

- Replace `const currentUser = useSelector(...)` with:
  ```ts
  import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
  const { user } = useCurrentUser();
  ```
- Replace the `clearUser()` dispatch + `window.location.href = "/login"` logout with a form that calls `signOutAction`:
  ```ts
  import { signOutAction } from "@/features/auth/services/authActions";
  // In JSX:
  <form action={signOutAction}>
    <button type="submit">Log out</button>
  </form>
  ```
- Remove the `getFakeUsers()` user-switcher entirely. Display only the current user's `user.displayName ?? user.email` in the avatar button.
- Remove `import type { User } from "@/features/kanban/types"` — the `Profile` type from `"@/features/auth/types"` is what you need.

### `src/app/page.tsx`

**Current bad pattern:**
```ts
"use client"
// ... Redux-based redirect in useEffect
const currentUser = useSelector((state: RootState) => state.auth.currentUser);
useEffect(() => { if (currentUser) router.replace("/kanban") ... }, [...])
```

**What to replace with:**

Convert to a Server Component that issues a server-side redirect:
```ts
// src/app/page.tsx (Server Component — no 'use client')
import { redirect } from "next/navigation";

export default function Home() {
  // Middleware handles auth. Authenticated users going to / will be
  // redirected to /kanban by middleware (AUTH_ONLY_PATHS does not include
  // "/" but the app can redirect here). Simplest approach: always redirect
  // unauthenticated visitors to /login (middleware will catch protected routes)
  // or redirect to /kanban (middleware will bounce to /login if unauthenticated).
  redirect("/kanban");
}
```

Alternatively keep it as a client component with a simple "Redirecting…" message — the middleware will enforce the actual redirect. The Redux `auth.currentUser` guard must be removed regardless.

### `src/app/kanban/page.tsx`

**Current bad pattern:**
```ts
const currentUser = useSelector((state: RootState) => state.auth.currentUser);
useEffect(() => { if (currentUser === null) router.replace("/login"); }, [...]);
if (currentUser === null) return <div>Redirecting...</div>;
```

**What to replace with:**

Remove the Redux auth guard entirely. Middleware enforces auth server-side before the page renders. You may optionally use `useCurrentUser()` to display the user's profile within the page, but it must not be used as a redirect gate.

```ts
"use client";
import KanbanDashBoard from "@/features/kanban";
// No auth guard needed — middleware handles it.
export default function KanbanPage() {
  return <KanbanDashBoard />;
}
```

---

## New Frontend Pages/Routes Required

The backend Server Actions are ready. The frontend must create the following pages.

### `/signup` — `src/app/signup/page.tsx`

A signup form that calls `signUpAction(formData)`:
- Inputs: `name="email"`, `name="password"`, optional `name="displayName"`.
- On `result.success === true`: `router.push("/kanban")` — a session is already established (Approach A, see Signup Contract below).
- On `result.success === false`: display `result.error.message`.
- Link back to `/login`.

### `/reset-password` — `src/app/reset-password/page.tsx`

A form that calls `resetPasswordAction(formData)`:
- Input: `name="email"`.
- Always display a success message after submission regardless of result — never reveal whether the email is registered (FR-05).

### `/reset-password/confirm` — `src/app/reset-password/confirm/page.tsx`

A form that calls `updatePasswordAction(formData)`:
- Input: `name="password"`.
- **Do NOT call `supabase.auth.exchangeCodeForSession()` here.** The session is established server-side by `/api/auth/callback` before the user arrives at this page.
- On `result.success === true`: `router.push("/login")` with a success toast/message.
- On `result.success === false` (token expired, etc.): display `result.error.message` and prompt the user to request a new reset email.

### Auth Layout — `src/app/(auth)/layout.tsx` (or equivalent)

Auth pages (`/login`, `/signup`, `/reset-password`, `/reset-password/confirm`) should share a minimal layout: no sidebar, no main-app navigation. Create a route group `(auth)` and move those pages under it, or apply a layout at `src/app/login/layout.tsx` individually. A shared auth layout already exists at `src/app/login/layout.tsx` — extend the pattern.

---

## Public API Surface

### Server Actions — `src/features/auth/services/authActions.ts`

All actions are `"use server"` and return `ActionResult<T>` — a discriminated union. They never throw.

| Action | Input (FormData fields) | Return on success | Return on failure |
|---|---|---|---|
| `signUpAction` | `email`, `password`, `displayName?` | `{ success: true, data: { profile: Profile } }` | `{ success: false, error: { code: AppErrorCode, message: string } }` |
| `signInAction` | `email`, `password`, `redirectTo?` | `{ success: true, data: { redirectTo: string } }` | `{ success: false, error: { code: AppErrorCode, message: string } }` |
| `signOutAction` | (none) | never — calls `redirect("/login")` directly | same — always redirects |
| `resetPasswordAction` | `email` | `{ success: true, data: { sent: true } }` | `{ success: false, error: ... }` |
| `updatePasswordAction` | `password` | `{ success: true, data: { updated: true } }` | `{ success: false, error: ... }` |

### Hook — `src/features/auth/hooks/useCurrentUser.ts`

```ts
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";

const { user, isLoading, error } = useCurrentUser();
// user: Profile | null
// isLoading: boolean
// error: Error | null
```

Query key: `['auth', 'profile']` — use `authQueryKeys.profile` exported from the same file.

### Types — `src/features/auth/types/index.ts`

```ts
export type Role = "admin" | "employee";

export interface Profile {
  id: string;
  companyId: string;
  role: Role;
  isPlatformAdmin: boolean;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AppErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_EMAIL_ALREADY_IN_USE"
  | "AUTH_WEAK_PASSWORD"
  | "AUTH_USER_NOT_FOUND"
  | "AUTH_SESSION_MISSING"
  | "AUTH_TOKEN_INVALID"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_CREATE_FAILED"
  | "COMPANY_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNKNOWN_ERROR";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: AppErrorCode; message: string } };
```

---

## Signup Redirect Contract (Approach A — Auto-confirm, No Email Verification)

The backend uses **Approach A**: after `createAuthUser` + `createProfile` succeed, `AuthService.signUp` immediately calls `repo.signIn({ email, password })` to establish the session cookie before returning. This means:

- When `signUpAction` returns `{ success: true, data: { profile } }`, a valid HTTP-only session cookie is already present in the response.
- The frontend should redirect immediately to `/kanban` (or any protected route).
- There is NO email confirmation step.
- There is NO separate `exchangeCodeForSession` call needed.

If Supabase Auth email confirmation is ever enabled:
- `AuthService.signUp` must be updated to NOT call `signIn` (the email will be unconfirmed so signIn will fail).
- `SignUpResult` becomes a discriminated union with `{ emailConfirmationRequired: true }`.
- The frontend must then show a "Check your email" message instead of redirecting to `/kanban`.
- A new backend-to-frontend handoff doc must be issued for that change.

---

## Password Reset Flow (End-to-End)

1. User submits `/reset-password` form → `resetPasswordAction` sends email via Supabase Auth.
2. Supabase Auth sends an email with a link to `/api/auth/callback?code=<code>&next=/reset-password/confirm`.
3. User clicks the link → `GET /api/auth/callback` runs server-side:
   - Calls `supabase.auth.exchangeCodeForSession(code)`.
   - On success: redirects to `/reset-password/confirm` with the session cookie set.
   - On failure: redirects to `/login?error=auth_callback_failed`.
4. User sees `/reset-password/confirm` — the session is already valid.
5. User submits new password → `updatePasswordAction(formData)` runs.
6. On success: frontend redirects to `/login` with a success message.

**Critical:** The frontend MUST NOT call `supabase.auth.exchangeCodeForSession()`. Step 3 handles it server-side. Any client-side code that tries to handle the `#access_token` hash or `code` param will conflict with the callback route and break the flow.

---

## Middleware Contract

File: `src/middleware.ts`

| Route | Behavior |
|---|---|
| `/` | Public — no auth required |
| `/login` | Auth-only — authenticated users are redirected to `/kanban` |
| `/signup` | Auth-only — authenticated users are redirected to `/kanban` |
| `/how-it-works` | Public |
| `/reset-password` | Auth-only (authenticated users should not see it) |
| `/reset-password/confirm` | Public — must be accessible to the user following the reset link before login |
| `/api/auth/callback` | Public — the code-exchange route runs before session exists |
| All other routes | Protected — unauthenticated users redirected to `/login?redirect=<original-path>` |

**Redirect query param convention:**
- Unauthenticated users hitting a protected route are redirected to `/login?redirect=/original/path`.
- `signInAction` validates and returns `redirectTo` in its success payload.
- The login page reads `searchParams.get("redirect")` and passes it as the `redirectTo` hidden input.
- `isSafeRedirectPath()` (exported from `authActions.ts`) validates the path — only relative paths starting with `/` (but not `//`) are accepted.

---

## Query Invalidation

After any successful auth mutation, invalidate the profile cache so `useCurrentUser()` re-fetches:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { authQueryKeys } from "@/features/auth/hooks/useCurrentUser";

const queryClient = useQueryClient();

// After signInAction succeeds:
queryClient.invalidateQueries({ queryKey: authQueryKeys.profile });

// After signUpAction succeeds:
queryClient.invalidateQueries({ queryKey: authQueryKeys.profile });

// After signOutAction (if you handle it client-side instead of via form action):
queryClient.invalidateQueries({ queryKey: authQueryKeys.profile });
```

If using the `form action={signOutAction}` pattern, the page will be server-redirected to `/login` and the cache will naturally be stale — no explicit invalidation needed.

---

## MUST NOT List

These are patterns that will silently break auth or create security vulnerabilities. Do not implement them.

1. **Never import `src/lib/supabase/server.ts` or `src/lib/env.server.ts` in any `"use client"` file.** These are guarded by `import "server-only"` — the Next.js build will fail if you do, which is intentional.
2. **Never import `SUPABASE_SERVICE_ROLE_KEY` in client code.** It is in `env.server.ts`. Only `env.public.ts` values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are browser-safe.
3. **Never call the `create_profile_for_user` RPC from the browser client.** It is EXECUTE-granted to the service role only and requires the service-role client.
4. **Never write to `profiles.role` or `profiles.is_platform_admin` from the browser.** These columns are write-protected via RLS and can only be mutated via the service-role client in Server Actions.
5. **Never store the session in `localStorage` or any client-side store.** The session lives in an HTTP-only cookie managed by `@supabase/ssr`. Never mirror it in Redux or `useState`.
6. **Never use `useEffect` + `router.push` as an auth redirect gate.** Middleware handles all auth redirects server-side. Client-side redirects flash protected content before redirecting and are explicitly forbidden by ADR-0011.
7. **Never call `supabase.auth.signInWithPassword` from a client component.** Use `signInAction` from `authActions.ts`. This keeps session cookie writes server-side.
8. **Never pass an absolute URL as `redirectTo` to any auth action.** `isSafeRedirectPath()` rejects them. Open redirects are a security vulnerability.
9. **Never call `supabase.auth.exchangeCodeForSession()` in the frontend.** The `/api/auth/callback` route handler does this server-side.
10. **Never use `state.auth.currentUser` from the Redux `authSlice`.** `authSlice.ts` is scheduled for deletion (ADR-0012). Use `useCurrentUser()` instead.

---

## Environment Variables the Frontend Needs to Know About

| Variable | Scope | Set in `.env.local`? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Yes |
| `NEXT_PUBLIC_APP_URL` | **Server only** (used as `APP_URL` in `env.server.ts`) | Yes — set to `http://localhost:3000` for local dev |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Yes — never expose to the browser |

The `NEXT_PUBLIC_APP_URL` variable is required by the server. Even though it has the `NEXT_PUBLIC_` prefix, it is only consumed server-side (`env.server.ts`) in this project. Do NOT read it client-side.

---

## Suggested Implementation Order

The frontend engineer should execute these steps in order. Each step is independently testable.

- [ ] 1. Fix `src/app/page.tsx` — remove Redux auth guard. Convert to a Server Component with `redirect("/kanban")` or keep client component without the `useSelector` auth check.
- [ ] 2. Fix `src/app/kanban/page.tsx` — remove `useSelector(state.auth.currentUser)` guard and `useEffect` redirect. Middleware handles this.
- [ ] 3. Fix `src/app/login/page.tsx` — replace fake user picker with a real email/password form calling `signInAction`.
- [ ] 4. Fix `src/features/kanban/components/KanbanHeader.tsx` — replace `authSlice` imports with `useCurrentUser()` and `signOutAction`.
- [ ] 5. Create `src/app/signup/page.tsx` — signup form calling `signUpAction`.
- [ ] 6. Create `src/app/reset-password/page.tsx` — reset request form calling `resetPasswordAction`.
- [ ] 7. Create `src/app/reset-password/confirm/page.tsx` — new password form calling `updatePasswordAction`. No `exchangeCodeForSession` call needed.
- [ ] 8. Delete `src/store/slices/authSlice.ts` and remove all references. The TypeScript build will surface any missed imports.
- [ ] 9. Verify `src/app/AuthHydration.tsx` (if it still exists) is deleted and removed from the root layout.
- [ ] 10. Run `next build` — it must complete with zero TypeScript errors.
- [ ] 11. Smoke test: sign up → land on `/kanban`; log out → land on `/login`; visit `/kanban` while logged out → redirect to `/login`.
- [ ] 12. Smoke test the password reset flow end-to-end: request email → click link → `/api/auth/callback` exchanges code → `/reset-password/confirm` → submit new password → `/login`.

---

## Deferred (Not Blocking)

The following review findings are intentionally not addressed in this backend pass. They are not blocking the frontend integration but should be addressed in a follow-up:

- **M-1 through M-7** — Medium findings (to be listed in code review follow-up)
- **L-1 through L-5** — Low findings (to be listed in code review follow-up)

These will be tracked in a separate PR. The frontend engineer can proceed without waiting for them.
