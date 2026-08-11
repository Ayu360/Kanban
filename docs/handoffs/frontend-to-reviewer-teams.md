# Teams Frontend → Reviewer Handoff

**Prepared by:** Frontend Agent
**Date:** 2026-08-10
**Status:** READY FOR FRONTEND REVIEW

---

## Overview

The Teams frontend module is complete. This document describes everything the
reviewer needs to verify. The database and backend phases were already approved
before this handoff.

---

## Completed Work

### New Mutation Hooks (src/features/teams/hooks/)

| Hook | Action | Cache Invalidation |
|---|---|---|
| `useCreateTeam` | `createTeamAction` | `teamsQueryKeys.all` (broad) |
| `useRenameTeam` | `renameTeamAction` | `teamsQueryKeys.lists()` + `teamsQueryKeys.detail(teamId)` |
| `useDeleteTeam` | `deleteTeamAction` | `teamsQueryKeys.all` (broad) |
| `useAddTeamMember` | `addTeamMemberAction` | `teamsQueryKeys.members(teamId)` |
| `useRemoveTeamMember` | `removeTeamMemberAction` | `teamsQueryKeys.members(teamId)` |

All invalidation strategies follow the backend handoff cache invalidation table exactly.

### New UI Components (src/features/teams/components/)

| Component | Purpose |
|---|---|
| `ConfirmDialog` | Accessible destructive confirmation dialog; used for delete |
| `TeamFormModal` | Create / rename team form; client-side validation + backend error surface |
| `AddMemberModal` | Add member by Profile ID (interim; see Known Limitations) |
| `TeamsEmptyState` | Empty state for no teams — different copy for admin vs employee |
| `TeamCard` | Team row in the list; admin shows rename + delete; employee read-only |
| `TeamMemberRow` | Member row; admin shows remove button; employee read-only |
| `TeamsPageContent` | Orchestrates `/teams` — list + create/rename/delete modals |
| `TeamDetailContent` | Orchestrates `/teams/[teamId]` — detail header + members section |
| `TeamMembersList` | Members section — uses `useTeamMembers` + add/remove |

### New Pages (src/app/teams/)

| Route | File | Notes |
|---|---|---|
| `/teams` | `page.tsx` + `layout.tsx` | Teams list; protected by middleware |
| `/teams/[teamId]` | `[teamId]/page.tsx` + `[teamId]/layout.tsx` | Team detail; uses React 19 `use(params)` |

### Modified Files

| File | Change |
|---|---|
| `src/features/kanban/components/KanbanHeader.tsx` | Added "Teams" nav link to `/teams` between logo and "How it works" |

---

## Frontend Architecture

### State Architecture

- **TanStack Query owns all server state** — `useTeams`, `useTeam`, `useTeamMembers` (existing read hooks from backend). New mutation hooks follow the same pattern.
- **Redux not used** — no Teams data in Redux. UI modal state (open/close, error messages, pending IDs) lives in React component state (`useState`). This is correct: modal state is ephemeral, not shared across the tree, and does not need Redux.
- No server state is duplicated into Redux anywhere in the Teams feature.

### Query Key Strategy

Uses `teamsQueryKeys` factory exported from `useTeams.ts` (backend-provided):
```
teamsQueryKeys.all              → ['teams']
teamsQueryKeys.lists()          → ['teams', 'list']
teamsQueryKeys.list(callerId)   → ['teams', 'list', callerId]
teamsQueryKeys.detail(teamId)   → ['teams', 'detail', teamId]
teamsQueryKeys.members(teamId)  → ['teams', 'members', teamId]
```

### Component Decomposition

Each component is under ~150 lines. Complex orchestration is split across:
- `TeamsPageContent` (list view orchestrator)
- `TeamDetailContent` (detail view orchestrator)
- `TeamMembersList` (members sub-section, self-contained with its own add/remove mutations)

Shared, reusable building blocks: `ConfirmDialog`, `TeamFormModal`, `TeamCard`, `TeamMemberRow`, `TeamsEmptyState`.

---

## Backend Integration

### Server Actions used

| Action | Input | Output |
|---|---|---|
| `createTeamAction({ companyId, name })` | companyId from `useCurrentUser().user.companyId` | `ActionResult<CreateTeamResult>` |
| `renameTeamAction(teamId, name)` | teamId + name | `ActionResult<Team>` |
| `deleteTeamAction(teamId)` | teamId only | `ActionResult<void>` |
| `addTeamMemberAction(teamId, profileId)` | teamId + profileId | `ActionResult<void>` |
| `removeTeamMemberAction(teamId, profileId)` | teamId + profileId | `ActionResult<void>` |

**companyId for createTeamAction** always derives from `useCurrentUser()` — never
from a form field, URL parameter, or user input. This is enforced in `handleCreate`
inside `TeamsPageContent`.

**deleteTeamAction** is called with `teamId` only — no companyId is passed, as
required by the backend security contract.

**No identity claims** (callerId, userId, role) are passed to any Server Action.

**No direct Supabase mutations from the client** — all writes go through Server Actions.
Reads use the browser Supabase client via the existing read hooks (`useTeams`,
`useTeam`, `useTeamMembers`), which is the established backend pattern.

### Error handling

All mutation `onSuccess` callbacks check `result.success`. On failure, `result.error.message`
is displayed in the relevant modal (create, rename) or as a page-level banner (delete,
remove member). No raw Supabase or Postgres messages are shown to the user — the
backend already normalizes these.

---

## Query / Cache Strategy

| Mutation | On success: invalidate |
|---|---|
| Create team | `teamsQueryKeys.all` — broad; ensures list refreshes |
| Rename team | `teamsQueryKeys.lists()` + `teamsQueryKeys.detail(teamId)` — targeted |
| Delete team | `teamsQueryKeys.all` — broad; removed team's entries cleared |
| Add member | `teamsQueryKeys.members(teamId)` — targeted |
| Remove member | `teamsQueryKeys.members(teamId)` — targeted |

After delete success, the component calls `router.push('/teams')` to navigate
away before the now-stale team detail can re-render.

---

## Permissions (Role-Based UX)

| Role | Teams list | Create | Rename | Delete | Add member | Remove member |
|---|---|---|---|---|---|---|
| Employee | Sees own teams only (RLS) | Hidden | Hidden | Hidden | Hidden | Hidden |
| Company admin | Sees all company teams | Visible | Visible | Visible | Visible | Visible |
| Platform admin | Sees all company teams (MVP) | Visible | Visible | Visible | Visible | Visible |

UX gating condition: `user.role === 'admin' || user.isPlatformAdmin` from `useCurrentUser()`.

These are UX controls only. Backend (RLS + service layer) is the authoritative
authorization boundary.

---

## Frontend Validation

| Field | Rules | Location |
|---|---|---|
| Team name (create) | Required, non-empty after trim, max 100 chars | `TeamFormModal` |
| Team name (rename) | Required, non-empty after trim, max 100 chars | `TeamFormModal` |
| Profile ID (add member) | Required, UUID format regex | `AddMemberModal` |

Backend validation is authoritative. Frontend validation is UX-only.
CONFLICT errors (duplicate name) are surfaced from the backend and displayed
inside the relevant modal via the `errorMessage` prop.

---

## Loading / Error / Empty States

| View | Loading | Error | Empty |
|---|---|---|---|
| Teams list | Spinner centered | Alert banner, prompt to refresh | `TeamsEmptyState` (different copy for admin vs employee) |
| Team detail | Spinner centered | Not-found state with back link | N/A (team exists or not-found is shown) |
| Members list | Inline spinner | Alert banner, prompt to refresh | "No members yet" dashed border state |
| Create/rename modal | Button spinner + disabled | Inline error below input | N/A |
| Delete dialog | Button spinner + both disabled | N/A | N/A |
| Add member modal | Button spinner + disabled | Inline error below input | N/A |
| Delete (list view) | Per-card trash spinner | Page-level banner after close | N/A |
| Remove member | Per-row remove spinner | Per-row error message | N/A |

---

## Accessibility

- All modals: `role="dialog"` `aria-modal="true"` `aria-labelledby` wired to `h2` id.
- Error messages: `role="alert"` for screen reader announcement.
- `aria-invalid` and `aria-describedby` on inputs when errors present.
- Destructive buttons: `aria-label` includes team/member name for context.
- Loading buttons: `aria-hidden` spinners; visible text changes to "Deleting...", "Creating...", etc.
- Escape key closes all modals (while not pending).
- Backdrop click closes modals (while not pending).
- Cancel button receives focus on confirm dialog open (safer default for destructive action).
- Auto-focus on first input for create/rename/add member modals.
- Semantic `<nav>` breadcrumb on detail page. `<section aria-labelledby>` for members.
- `<ul role="list" aria-label="Teams list">` for the teams list.
- `<main>` wrapper on both pages.

---

## Known Limitations

### 1. Add Member — Employee Picker Pending

**PRD FR-04** requires an employee picker listing company employees by name.
The Employees module (03-employees.md) has not been implemented. The current
`AddMemberModal` accepts a raw Profile UUID as a workaround.

**Action required:** When the Employees module is complete, `AddMemberModal` should
be upgraded to a searchable employee picker using the Employees read API. The
backend contract for `addTeamMemberAction` does not need to change.

### 2. Board Navigation

The board link in `TeamDetailContent` currently links to `/teams/[teamId]` (the
same detail page) because the Board module is not yet implemented as a routable
page. When `/teams/[teamId]/board` is implemented, update the `href` in
`TeamDetailContent` line ~131.

### 3. Member Count on TeamCard

`TeamCard` receives `memberCount: null` from the list page because fetching
member count for every team in the list would require N+1 queries. Two options
for future:
- Return member count from the `useTeams` query (requires a backend change to
  join/count `team_members` in the list query).
- Accept the N+1 and use `useTeamMembers` per card (not recommended at scale).
Post-MVP.

---

## Tests

No test framework (jest, vitest) is installed in this project. The `package.json`
contains no testing devDependencies. Tests cannot be written or run.

**Recommended action:** Install vitest + @testing-library/react and write the
test suite described in the implementation prompt. This is a pre-existing gap in
the project, not introduced by this PR.

---

## Ownership Verification

Frontend Agent modified:
- `src/features/teams/hooks/` — 5 new mutation hooks (frontend-only)
- `src/features/teams/components/` — 9 new UI components (frontend-only)
- `src/app/teams/` — 4 new pages/layouts (frontend-only)
- `src/features/kanban/components/KanbanHeader.tsx` — added Teams nav link (frontend-only)

Frontend Agent did NOT modify:
- `src/features/teams/repositories/` — backend, untouched
- `src/features/teams/services/teamsService.ts` — backend, untouched
- `src/features/teams/services/teamsActions.ts` — backend, untouched
- `src/features/teams/hooks/useTeams.ts` — read hook provided by backend, untouched
- `src/features/teams/hooks/useTeam.ts` — read hook provided by backend, untouched
- `src/features/teams/hooks/useTeamMembers.ts` — read hook provided by backend, untouched
- `supabase/migrations/` — database, untouched
- `src/lib/` — untouched
- Any auth files — untouched

The three backend LOW notes from the backend reviewer (dead AppError import,
check_violation fallback, unused service read methods) were not touched.

---

## Handoffs

### Backend handoff required — Employee Picker

**Problem:** `AddMemberModal` currently uses a raw UUID input instead of a
searchable employee picker.

**Why it matters:** UX is poor; admins must know the exact Profile UUID to add
a member.

**Backend contract needed:** A read hook `useCompanyProfiles()` (or similar)
that returns `{ id, displayName, role }[]` for all profiles in the caller's
company. This is part of the Employees module (03-employees.md).

**Blocking:** Non-blocking. The UUID input works correctly end-to-end. The
employee picker is a UX improvement, not a functional gap.

**Recommended action:** Implement the Employees module, then update
`AddMemberModal` to use the employee data.

---

## Final Status

READY FOR FRONTEND REVIEW
