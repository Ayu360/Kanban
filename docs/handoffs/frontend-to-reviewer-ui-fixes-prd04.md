# Frontend to Reviewer: UI/UX Fixes — PRD 04 Browser Testing (f/ui-fixes)

## Overview

Four polish/usability fixes discovered during browser testing of the fully-shipped PRD 04 (tasks module). All are frontend-only. No backend, DB, or migration changes.

## Completed Work

### Fix 1 — Logout button loading state (`KanbanHeader.tsx`)

Extracted a `LogoutButton` client subcomponent (inline, ~20 lines) that uses `useFormStatus()` from `react-dom`. When the `signOutAction` Server Action is in-flight, `pending` is `true` — the button disables, swaps the SVG icon for a spinner, and shows "Signing out..." label. Destructive red styling and `role="menuitem"` preserved.

### Fix 2a — Remove global AppFooter

- Removed the `<AppFooter />` render and its import from `src/app/layout.tsx`.
- Deleted `src/components/AppFooter.tsx` entirely (no other consumers).
- The `body` flex layout (`flex min-h-screen flex-col`) now has one child (`min-h-0 flex-1`), which stretches correctly.

### Fix 2b — Mobile burger navigation menu (`KanbanHeader.tsx`)

Added a hamburger button (`sm:hidden`) to the left of the logo. Clicking it opens a dropdown (`role="menu"`) below the button using the same fixed-backdrop click-outside-dismiss pattern as the existing user menu. Menu items: Teams, Employees (admin-only, respects `isAdmin`), How it works — each is a `<Link role="menuitem">` that closes the burger on click. Escape key closes the burger. The desktop nav links remain `hidden sm:block` (unchanged). The burger does not duplicate the user menu — nav links only.

### Fix 3 — Search bar only on board pages (`KanbanHeader.tsx`)

Added `showSearch` boolean:
```ts
const showSearch = pathname === "/kanban" || /^\/teams\/[^/]+\/board$/.test(pathname);
```
The entire search `<div>` is wrapped in `{showSearch && (...)}`. On non-board pages (`/teams`, `/employees`, `/teams/[teamId]`), the search input is unmounted. The right-side flex container (`flex min-w-0 flex-1 items-center gap-2`) still renders correctly with only the user menu button when search is hidden — no layout collapse.

### Fix 4 — Dark mode input text visibility (`dark:focus:bg-*`)

Added `dark:focus:bg-<matching-idle-dark-bg>` to every `focus:bg-white` input/textarea/select/button that lacked a dark mode focus background override. All modals in this codebase use `dark:bg-slate-700` as the idle input bg (except the KanbanHeader search which uses `dark:bg-slate-800` — already fixed before this batch). Total: 12 occurrences fixed across 8 files.

## Files Changed

**Modified:**
- `src/features/kanban/components/KanbanHeader.tsx` — Fixes 1, 2b, 3; added `LogoutButton` subcomponent and burger menu state
- `src/app/layout.tsx` — Fix 2a: removed AppFooter import and render
- `src/features/kanban/components/EditModal.tsx` — Fix 4: 4 occurrences
- `src/features/kanban/components/AddCardModal.tsx` — Fix 4: 2 occurrences
- `src/features/kanban/components/MoveCardModal.tsx` — Fix 4: 1 occurrence
- `src/features/teams/components/TeamMembersList.tsx` — Fix 4: 1 occurrence
- `src/features/teams/components/TeamFormModal.tsx` — Fix 4: 1 occurrence
- `src/features/teams/components/AddMemberModal.tsx` — Fix 4: 1 occurrence
- `src/features/employees/components/InviteEmployeeModal.tsx` — Fix 4: 1 occurrence
- `src/features/employees/components/EmployeesPageContent.tsx` — Fix 4: 1 occurrence

**Deleted:**
- `src/components/AppFooter.tsx` — Fix 2a: no consumers, deleted entirely

## Public Interfaces

None changed. All fixes are internal UI behavior.

## Assumptions

- `useFormStatus` is available (`react-dom` ≥ 18.3, which this project already uses).
- `signOutAction` uses `redirect()` after sign-out — the Server Action already redirects, so there is no client-side navigation to handle.
- AppFooter had zero consumers other than `layout.tsx` (confirmed by grep before deletion).
- Board-page search regex (`/^\/teams\/[^\/]+\/board$/`) correctly matches `/teams/[teamId]/board` and nothing else.
- Dark mode idle bg for all modal inputs is `dark:bg-slate-700`; KanbanHeader search is `dark:bg-slate-800` (both were correct, applied accordingly).

## Known Limitations

- Burger menu has no arrow-key navigation between items (out of scope per brief).
- Burger menu has no animation/transition (out of scope per brief).
- The `<img>` tag for the logo in KanbanHeader remains (pre-existing lint warning, out of scope).

## Next Steps

- Reviewer: verify burger menu does not overlap logo/search on real mobile viewport (375px).
- Reviewer: verify logout spinner renders correctly — the `border-t-red-600` / `border-red-300` spinner matches the red destructive color scheme.
- Reviewer: confirm search hides cleanly on `/teams` and `/employees` without flex collapse.
- Reviewer: smoke-test dark mode focus on a modal input to confirm text is visible while focused.
