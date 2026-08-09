# Frontend-to-Reviewer Handoff: Authentication Module

## Completed

### Core Auth Integration
- Replaced the fake-user-picker login with a real email/password form calling `signInAction`.
- Created signup page (`/signup`) calling `signUpAction` with immediate redirect to `/kanban` (Approach A — no email confirmation).
- Created password reset request page (`/reset-password`) calling `resetPasswordAction`; always shows success message (no email enumeration).
- Created password reset confirm page (`/reset-password/confirm`) calling `updatePasswordAction`; validates password match client-side; does NOT call `exchangeCodeForSession` (that is handled by `/api/auth/callback`).
- Integrated `signOutAction` into `KanbanHeader` via a `<form action={signOutAction}>` — no client-side redirect or `window.location.href`.
- Replaced all `useSelector(state.auth.currentUser)` reads with `useCurrentUser()` from `@/features/auth/hooks/useCurrentUser`.
- Converted `src/app/page.tsx` from a client component with a Redux auth guard to a Server Component that calls `redirect("/kanban")`.
- Removed the Redux auth guard from `src/app/kanban/page.tsx` — middleware handles protection.

### Legacy Cleanup
- Removed all `import { setUser, clearUser } from "@/store/slices/authSlice"` references (login page and KanbanHeader).
- Removed all `import { getFakeUsers } from "@/lib/fakeApi"` references (login page and KanbanHeader).
- Removed the fake user-switcher dropdown entirely from KanbanHeader.
- Removed the `useEffect` + `router.replace` auth guard pattern from `page.tsx` and `kanban/page.tsx`.
- Confirmed `AuthHydration` was already removed from the root layout prior to this PR (Providers.tsx comment confirms it).
- `src/store/slices/authSlice.ts` does not exist (was deleted in a prior backend pass); confirmed no import targets it.

### Auth Layout
- Created `src/app/(auth)/layout.tsx` route group for `/signup`, `/reset-password`, and `/reset-password/confirm`.
- The `/login` page retains its existing `src/app/login/layout.tsx` pattern.

---

## Files Created

- `src/app/(auth)/layout.tsx` — Minimal auth route group layout
- `src/app/(auth)/signup/page.tsx` — Signup form
- `src/app/(auth)/reset-password/page.tsx` — Password reset request form
- `src/app/(auth)/reset-password/confirm/page.tsx` — New password form

---

## Files Modified

- `src/app/page.tsx` — Converted to Server Component; replaced Redux guard with `redirect("/kanban")`
- `src/app/kanban/page.tsx` — Removed Redux auth guard; now a minimal `"use client"` wrapper
- `src/app/login/page.tsx` — Replaced fake user picker with real sign-in form
- `src/features/kanban/index.tsx` — Replaced `useSelector(state.auth.currentUser)` with `useCurrentUser()`
- `src/features/kanban/components/KanbanHeader.tsx` — Replaced authSlice+getFakeUsers with `useCurrentUser()` + `signOutAction`

---

## Backend Interfaces Used

| Interface | Consumed in | Purpose |
|---|---|---|
| `signInAction` from `@/features/auth/services/authActions` | `src/app/login/page.tsx` | Authenticate user, returns `{ redirectTo }` |
| `signUpAction` from `@/features/auth/services/authActions` | `src/app/(auth)/signup/page.tsx` | Create account + auto-sign-in (Approach A) |
| `signOutAction` from `@/features/auth/services/authActions` | `src/features/kanban/components/KanbanHeader.tsx` | Sign out via form action, redirects to `/login` |
| `resetPasswordAction` from `@/features/auth/services/authActions` | `src/app/(auth)/reset-password/page.tsx` | Send password reset email |
| `updatePasswordAction` from `@/features/auth/services/authActions` | `src/app/(auth)/reset-password/confirm/page.tsx` | Set new password from valid reset session |
| `useCurrentUser` from `@/features/auth/hooks/useCurrentUser` | `src/features/kanban/index.tsx`, `KanbanHeader.tsx` | Read current user profile via TanStack Query |
| `authQueryKeys` from `@/features/auth/hooks/useCurrentUser` | `src/app/login/page.tsx`, `src/app/(auth)/signup/page.tsx` | Invalidate `['auth', 'profile']` after sign-in/sign-up |
| `Profile` type from `@/features/auth/types` | Consumed indirectly via `useCurrentUser()` return type | User profile shape |

---

## Removed Legacy Code

| Old artifact | Location | Replacement |
|---|---|---|
| `import { setUser } from "@/store/slices/authSlice"` | `src/app/login/page.tsx` | Removed; `signInAction` manages session server-side |
| `import { getFakeUsers } from "@/lib/fakeApi"` | `src/app/login/page.tsx` | Removed; real email/password form |
| `import { setUser, clearUser } from "@/store/slices/authSlice"` | `KanbanHeader.tsx` | Removed; `signOutAction` replaces `clearUser` + `window.location.href` |
| `import { getFakeUsers } from "@/lib/fakeApi"` | `KanbanHeader.tsx` | Removed; display name from `useCurrentUser()` |
| `type User` from `@/features/kanban/types` | `KanbanHeader.tsx` | Removed; `Profile` type used via `useCurrentUser()` |
| `useSelector(state.auth.currentUser)` + `useEffect` redirect | `src/app/page.tsx` | Replaced by `redirect("/kanban")` in Server Component |
| `useSelector(state.auth.currentUser)` + `useEffect` redirect | `src/app/kanban/page.tsx` | Removed; middleware enforces protection |
| `useSelector(state.auth.currentUser)` | `src/features/kanban/index.tsx` | `useCurrentUser()` hook |
| Fake user-switcher dropdown | `KanbanHeader.tsx` | Replaced with logged-in user display + logout form |
| `const users = useState<User[]>([])` + `getFakeUsers().then(setUsers)` | `KanbanHeader.tsx` | Removed entirely |

---

## Verification

1. **TypeScript build**: `npx tsc --noEmit` — exits with code 0, zero errors.
2. **Lint**: `npm run lint` — 0 new errors introduced. Pre-existing errors documented below.
3. **Legacy reference audit**: `grep -rn "authSlice|AuthHydration|getFakeUsers|state\.auth"` across all `.ts`/`.tsx` files — zero executable references; two comment-only occurrences in `useCurrentUser.ts` (docs) and `fakeApi.ts` (migration note).
4. **Flow trace (code review, not browser)**:
   - Login: form submits `signInAction` → on `success`, invalidates `authQueryKeys.profile` → `router.push(result.data.redirectTo)`.
   - Signup: form submits `signUpAction` → on `success` (session already set per Approach A), invalidates profile cache → `router.push("/kanban")`.
   - Logout: `<form action={signOutAction}>` → server-side redirect to `/login` by the action.
   - Reset password request: `resetPasswordAction` → always shows success message (no enumeration).
   - Reset confirm: `updatePasswordAction` → on `success`, `router.push("/login?passwordUpdated=1")`; on failure, shows error with link to re-request.
   - Protected page (unauthenticated): middleware redirects to `/login?redirect=<path>` — no client-side flash.
   - Auth page (authenticated): middleware redirects to `/kanban` — login/signup never rendered.

---

## Known Issues

1. **Pre-existing lint errors (not introduced by this PR)**:
   - `EditModal.tsx:44` — `react-hooks/set-state-in-effect` error (pre-existing).
   - `MoveCardModal.tsx:26` — `react-hooks/set-state-in-effect` error (pre-existing).
   - `authActions.ts:31` — `AppError` imported but unused (pre-existing; backend file, not touched).
   - `middleware.ts:87` — `searchParams` unused (pre-existing; backend file, not touched).
   - `KanbanHeader.tsx:43` — `<img>` instead of `<Image />` warning (pre-existing pattern; preserved to avoid scope creep).

2. **KanbanDashBoard still uses fakeApi for board data**: `src/api/board.ts` and `src/lib/fakeApi.ts` still serve board/column/topic data via the fake in-memory store. This is expected and intentional — per `PROJECT_CONTEXT.md` migration step 4, `SupabaseBoardRepository` is a separate future PR. The auth migration is complete; the board data migration is not in scope.

3. **KanbanDashBoard `userId` fallback**: After removing the authSlice, `userId` is now sourced from `useCurrentUser().user?.id`. If `user` is `null` (which should not happen on a protected route due to middleware), `userId` defaults to `""`. This is defensive — middleware guarantees an authenticated user before KanbanPage renders.

4. **`/login?passwordUpdated=1` success message**: The confirm page redirects with `?passwordUpdated=1`. The login page does not currently read this param to display a toast/banner. This is a minor UX improvement deferred to a follow-up; the reset flow is functionally complete.

---

## Reviewer Notes

1. **Ownership boundary**: Verify no backend file (`src/lib/**`, `src/features/auth/services/**`, `src/features/auth/repositories/**`, `src/middleware.ts`, `src/app/api/**`) was modified. Only the five files listed in "Files Modified" and four new files were changed.

2. **`signOutAction` pattern**: The logout is implemented as `<form action={signOutAction}>`. This is a Next.js Server Action invoked from a form, which triggers a full server round-trip ending in `redirect("/login")`. This is intentional and correct — it avoids any client-side state that might need manual clearing.

3. **No `exchangeCodeForSession` on confirm page**: The reset-password confirm page intentionally does NOT call `supabase.auth.exchangeCodeForSession`. The `/api/auth/callback` route handler (backend, pre-existing) handles PKCE code exchange before the user reaches this page.

4. **Profile cache invalidation**: After `signInAction` and `signUpAction` succeed, the frontend explicitly calls `queryClient.invalidateQueries({ queryKey: authQueryKeys.profile })` before navigating. This ensures `useCurrentUser()` on the kanban page immediately reflects the authenticated session.

5. **`state.auth.currentUser` in KanbanDashBoard**: The old reference `const currentUser = useSelector((state: RootState) => state.auth.currentUser)` in `src/features/kanban/index.tsx` has been replaced with `const { user: currentUser } = useCurrentUser()`. The variable is renamed to `currentUser` for minimal diff. Note that `currentUser` is now `Profile | null` (not the old `User` type) — callers that passed `currentUser.id` now use `currentUser?.id ?? ""`.

6. **Auth route group `(auth)`**: The route group adds no URL segment — `/signup` is still at `/signup`, not `/(auth)/signup`. The parentheses are a Next.js App Router convention for layout grouping only.
