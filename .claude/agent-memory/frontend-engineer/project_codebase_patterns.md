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

## Pre-existing Lint Errors (status as of 2026-08-21)
- `EditModal.tsx` and `MoveCardModal.tsx`: `react-hooks/set-state-in-effect` — FIXED in PRD 04 FE-T-3 using the outer/inner component + key pattern.
- `middleware.ts`: `searchParams` unused warning — still present, do not touch.
- `KanbanHeader.tsx`: `<img>` instead of `next/image` warning — still present (preserve existing pattern).
- `teamsActions.ts`: unused `AppError` import — backend LOW note, do NOT touch from frontend.

## setState-in-useEffect Fix Pattern (established PRD 04, 2026-08-21)
When a form needs to reset its state when a prop (e.g. selected task/entity) changes:
- Do NOT use `useEffect(() => { setState(prop.value); }, [prop])` — this triggers the `react-hooks/set-state-in-effect` lint error.
- Instead: split into outer (wrapper, provides key) and inner (stateful form) components.
- The outer renders `<InnerForm key={entity.id} entity={entity} ... />`.
- React remounts InnerForm on key change, re-running useState initializers for the new entity.
- Pattern used in: `EditModal` and `MoveCardModal` (both in `src/features/kanban/components/`).

## Tasks Feature (PRD 04, implemented 2026-08-21)
- Hooks: `useBoard`, `useCreateTask`, `useUpdateTask`, `useMoveTask`, `useDeleteTask`, `useBoardIdByTeam` in `src/features/tasks/hooks/`.
- Barrel export at `src/features/tasks/hooks/index.ts` (does NOT include `useBoardIdByTeam` — route-specific).
- Types: `Task`, `Column`, `Board`, `TaskPriority`, `CreateTaskInput`, `UpdateTaskInput`, `MoveTaskInput`, `TasksError` from `src/features/tasks/types/index.ts`.
- Query key factory: `tasksQueryKeys` exported from `tasksQueryKeys.ts`, re-exported from hooks/index.ts.
- Canonical board route: `/teams/[teamId]/board` at `src/app/teams/[teamId]/board/page.tsx`.
- `/kanban` route: client-side redirect to first team's board via `useTeams()`.
- `KanbanDashBoard` now accepts `boardId: string` prop (not userId). Does not call useCurrentUser.
- Old kanban types (`Topic`, `BoardWithDetails`) are gone; use `Task`/`Column`/`Board` from tasks types.
- `useEmployeeDirectory()` used in EditModal for assignee picker. Filter `e.displayName !== null` before rendering picker options.
- `ConfirmDialog` (from teams feature) reused for task delete confirmation.

## Routing (updated 2026-08-21)
- Root `/` → Server Component redirect to `/kanban`.
- `/kanban` → client-side redirect to `/teams/[teamId]/board` (first team) or "no team" placeholder.
- `/teams/[teamId]/board` — canonical Kanban board page.
- Auth pages under `src/app/(auth)/` route group (no URL impact).
- `/login` has its own `src/app/login/layout.tsx`.
- Middleware enforces all auth checks — no `useEffect` redirect guards allowed (ADR-0011).

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

## Employees Feature (implemented 2026-08-15, PRD 05 Phase 3 added 2026-08-20)
- Components in `src/features/employees/components/`: `EmployeesPageContent`, `EmployeeCard`, `InviteEmployeeModal`, `EmployeeConfirmDialog`.
- Routes: `src/app/employees/` (admin management), `src/app/accept-invite/` (invite callback).
- Hooks: `useEmployees`, `useEmployeeDirectory`, `useInviteEmployee`, `useChangeEmployeeRole`, `useDeactivateEmployee`, `useReactivateEmployee`, `useActivateInvitedEmployee` (all pre-existing); plus PRD 05 additions: `useSoftDeleteEmployee`, `useHardDeleteEmployee`, `useUndoScheduledDeletion`, `useCancelInvite`, `useResendInvite`.
- Query key factory: `employeesQueryKeys` exported from `useEmployees.ts`.
- `EmployeeConfirmDialog` is a parameterized confirm dialog with `variant='default'|'destructive'` — candidate for promotion to shared component.
- `useEmployeeDirectory()` result must be filtered `employees.filter(e => e.displayName !== null)` before rendering pickers (pending employees have null displayName).
- `/accept-invite` is in middleware `PENDING_ALLOWED_PATHS` (line 85 of `src/middleware.ts`).
- Login page (`src/app/login/page.tsx`) reads `?error=deactivated` / `?error=pending` from `useSearchParams()` and shows amber banner.
- `EmployeesPageContent` uses three error banners + three Set-based pending trackers (role, status, deletion) for concurrent action isolation.
- `KanbanHeader` now shows "Employees" nav link to admins only (after Teams, before "How it works").
- **PRD 05 hook invalidation pattern inconsistency**: older hooks (deactivate/reactivate/invite) use conditional `onSuccess` invalidation; new PRD 05 hooks use unconditional invalidation (FE-1/tombstone pattern). Deferred cleanup.
- **`useEmployees` grace-window polling (FE-4)**: `refetchInterval` at 30s when any row has `deletionScheduledAt !== null`; uses TanStack Query v5 `query`-argument form.
- **`deletionScheduledAt` badge precedence**: `EmployeeCard` renders "Deletion Scheduled" (amber) badge instead of "Active" when `deletionScheduledAt !== null`. Tooltip via `title` attribute (a11y improvement deferred).
- **Quorum check in parent**: `hasOtherAdmin` is computed via `useMemo` in `EmployeesPageContent` and passed down to `EmployeeCard` to gate self-delete actions.
- **`DismissibleErrorBanner`**: declared module-level (not inside render) to avoid react-hooks/static-components lint error.
- **`AdminEmployee.deletionScheduledAt`**: ISO 8601 UTC string; formatted via `new Date(...).toLocaleString()` for user's local timezone.
