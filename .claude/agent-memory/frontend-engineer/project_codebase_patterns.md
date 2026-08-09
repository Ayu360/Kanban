---
name: Frontend Codebase Patterns
description: Key frontend patterns, conventions, and component locations discovered in this codebase
type: project
---

## Design System
- Tailwind v4. Dark mode via `dark:` variants. Primary accent: `sky-500`/`sky-600`. Slate for backgrounds/text.
- Auth pages: `bg-slate-50 dark:bg-slate-900`, `max-w-sm`, centered column layout.
- Form inputs: `rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm` + focus ring `focus:ring-sky-500/20`.
- Submit buttons: `bg-sky-500 hover:bg-sky-600 rounded-lg font-semibold` with spinner pattern.
- Error alerts: `role="alert"` div with `border-red-200 bg-red-50 text-red-700` (dark variants included).

## State Management
- TanStack Query v5 for all server state. Query client in `src/app/Providers.tsx` (singleton, no SSR).
- Redux Toolkit (ui slice only). `src/store/index.ts` exposes `store`, `RootState`, `AppDispatch`.
- `uiSlice` at `src/store/slices/uiSlice.ts` — only `searchQuery: string` currently.
- `authQueryKeys.profile = ['auth', 'profile']` — always invalidate after auth mutations.

## Auth Hooks/Actions
- `useCurrentUser()` from `@/features/auth/hooks/useCurrentUser` — returns `{ user: Profile | null, isLoading, error }`.
- Server Actions in `@/features/auth/services/authActions`: `signInAction`, `signUpAction`, `signOutAction`, `resetPasswordAction`, `updatePasswordAction`.
- `signOutAction` redirects server-side — use `<form action={signOutAction}>`, not a mutation hook.

## Routing
- Root `/` → Server Component redirect to `/kanban`.
- Auth pages under `src/app/(auth)/` route group (no URL impact).
- `/login` has its own `src/app/login/layout.tsx`.
- Middleware enforces all auth checks — no `useEffect` redirect guards allowed (ADR-0011).

## Pre-existing Lint Errors (do not fix without scoping)
- `EditModal.tsx` and `MoveCardModal.tsx`: `react-hooks/set-state-in-effect` errors.
- `middleware.ts`: `searchParams` unused warning.
- `KanbanHeader.tsx`: `<img>` instead of `next/image` warning (preserve existing pattern).
