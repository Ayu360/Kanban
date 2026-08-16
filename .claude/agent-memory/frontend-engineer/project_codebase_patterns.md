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
- `teamsActions.ts`: unused `AppError` import — backend LOW note, do NOT touch from frontend.

## Modal Accessibility Pattern (established 2026-08-10)
- `useFocusTrap(isOpen: boolean)` hook at `src/features/teams/hooks/useFocusTrap.ts`.
- Saves `document.activeElement` on open as restore target; restores on `isOpen → false`.
- Tab/Shift+Tab trapped within container via `document` keydown listener.
- Modals that mount/unmount (conditional render) pass `isOpen=true` since they're always visible when rendered.
- `ConfirmDialog` uses `isOpen` prop because it always mounts but conditionally shows.
- Container `div` gets `tabIndex={-1}` as fallback focus target if no focusable children.

## Teams Feature (implemented 2026-08-10)
- Mutation hooks: `useCreateTeam`, `useRenameTeam`, `useDeleteTeam`, `useAddTeamMember`, `useRemoveTeamMember` in `src/features/teams/hooks/`.
- Read hooks (backend-provided): `useTeams`, `useTeam`, `useTeamMembers` in same folder.
- Query key factory: `teamsQueryKeys` exported from `useTeams.ts`.
- Pages: `/teams` and `/teams/[teamId]` — both use `"use client"` and reuse `KanbanHeader`.
- `[teamId]/page.tsx` uses React 19 `use(params)` to unwrap the params Promise.
- Modal pattern: `body.style.overflow = 'hidden'` + escape key + backdrop click. Used across all modals.
- No test framework installed — no runnable tests for Teams. Gap documented in handoff.
- AddMemberModal upgraded to employee picker (backed by `useEmployeeDirectory`) in 2026-08-15 Employees module PR.
- Concurrent async state pattern: use `Set<string>` (not a single string) for per-row pending state (e.g. `removingProfileIds`).
- Member count (`memberCount`) is `null` pending backend aggregate; see `docs/handoffs/frontend-to-backend-teams-member-count.md`.
- L-2 aria-current pattern: `usePathname()` + `pathname.startsWith(route)` → `aria-current="page"` on nav links.

## Employees Feature (implemented 2026-08-15)
- Components in `src/features/employees/components/`: `EmployeesPageContent`, `EmployeeCard`, `InviteEmployeeModal`, `EmployeeConfirmDialog`.
- Routes: `src/app/employees/` (admin management), `src/app/accept-invite/` (invite callback).
- Hooks are backend-provided (read-only for frontend): `useEmployees`, `useEmployeeDirectory`, `useInviteEmployee`, `useChangeEmployeeRole`, `useDeactivateEmployee`, `useReactivateEmployee`, `useActivateInvitedEmployee`.
- Query key factory: `employeesQueryKeys` exported from `useEmployees.ts`.
- `EmployeeConfirmDialog` is a parameterized confirm dialog with `variant='default'|'destructive'` — candidate for promotion to shared component.
- `useEmployeeDirectory()` result must be filtered `employees.filter(e => e.displayName !== null)` before rendering pickers (pending employees have null displayName).
- `/accept-invite` is in middleware `PENDING_ALLOWED_PATHS` (line 85 of `src/middleware.ts`).
- Login page (`src/app/login/page.tsx`) reads `?error=deactivated` / `?error=pending` from `useSearchParams()` and shows amber banner.
- `EmployeesPageContent` uses two separate error banner + two separate Set-based pending trackers (one for role, one for status) to keep concurrent actions isolated.
- `KanbanHeader` now shows "Employees" nav link to admins only (after Teams, before "How it works").
