# Handoff: Frontend to Reviewer — Multi-Team Navigation UX

**Branch:** `f/multi-team-nav`  
**Author:** Frontend Engineer  
**Date:** 2026-08-21

---

## Overview

Frontend-only feature: multi-team navigation UX across 3 phases. No backend, DB, migrations, or server actions were touched.

---

## Completed Work

### Phase 0 — Fix broken Board button

**`src/features/teams/components/TeamDetailContent.tsx`**  
Line 224: `href={/teams/${teamId}}` → `href={/teams/${teamId}/board}`. Removed the stale "placeholder" comment on line 222.

### Phase 1 — Team Switcher

**`src/features/teams/hooks/useActiveTeamId.ts`** (new)  
Parses `teamId` from `usePathname()` using regex `/^\/teams\/([^/]+)(?:\/.*)?$/`. Returns `string | null`. Returns null for all non-team-scoped routes.

**`src/features/teams/components/TeamSwitcher.tsx`** (new)  
Presentational dropdown component. Props: `{ teams, activeTeamId, onOpenChange? }`. Trigger shows current team name (truncated at 80px), with `aria-label="Current team: {name}. Switch team."`, `aria-haspopup="true"`, `aria-expanded={open}`. Dropdown: `role="menu"` + `aria-label="Switch team"`, each item is `<Link role="menuitem">`. Closes on Escape and backdrop click. Calls `onOpenChange` on both open and close so parent can coordinate.

**`src/features/kanban/components/KanbanHeader.tsx`** (modified)  
- Added `useTeams`, `useActiveTeamId`, `TeamSwitcher` imports.
- Desktop: TeamSwitcher renders between Employees and How it works, hidden on mobile (`hidden sm:block`), conditional on `teams.length >= 2 && activeTeamId !== null`.
- Mobile burger: adds a "Switch team" section below existing nav links, separated by `border-t`, showing other teams as `role="menuitem"` links. Clicking navigates and closes the burger.
- Dropdown coordination: `handleSwitcherOpenChange` closes the user menu when switcher opens; the fixed-backdrop pattern on both dropdowns ensures they cannot both be open simultaneously (backdrop captures all clicks including on the other trigger).
- Phase 2c: `<form action={signOutAction} onSubmit={...}>` now clears `kanban:lastTeamId` from localStorage before the Server Action fires.

### Phase 2 — Last-Visited Team Redirect

**`src/features/teams/hooks/useRememberLastTeam.ts`** (new)  
Simple `useEffect` that sets `localStorage.setItem("kanban:lastTeamId", teamId)` on every board mount. Guards against SSR with `typeof window !== "undefined"`.

**`src/app/teams/[teamId]/board/page.tsx`** (modified)  
Mounts `useRememberLastTeam(teamId)` at the top of the component, before any conditional returns, so it fires on every board visit.

**`src/app/kanban/page.tsx`** (modified)  
New redirect priority:
1. `teams.length === 0` → no-teams placeholder (unchanged).
2. `teams.length === 1` → direct redirect (no localStorage lookup needed).
3. `teams.length >= 2` → read `localStorage.getItem("kanban:lastTeamId")`, validate against current team list (`teams.some(t => t.id === storedId)`), redirect if valid; fall back to first team alphabetically if missing or invalid.

---

## Public Interfaces

- `useActiveTeamId(): string | null` — hook, reads `usePathname()`
- `useRememberLastTeam(teamId: string): void` — hook, side-effect only
- `TeamSwitcher` — component, props `{ teams: Team[], activeTeamId: string, onOpenChange?: (open: boolean) => void }`
- localStorage key: `"kanban:lastTeamId"` — written by board page, read by `/kanban`, cleared on sign-out

---

## Assumptions

- `useTeams()` already returns teams sorted alphabetically ascending by name (confirmed: `ORDER BY name ASC` in `fetchTeams`). The `/kanban` fallback relies on this.
- `signOutAction` is a Server Action and cannot access localStorage. Clearing is done in the `onSubmit` handler of the wrapping form, which fires synchronously before the form submission.
- The fixed-backdrop pattern (each dropdown renders a `fixed inset-0 z-10` div) makes it impossible to open two dropdowns simultaneously — the active backdrop captures any click on other triggers. No explicit parent-controlled close of TeamSwitcher from the user menu toggle was needed.
- TeamSwitcher renders inside `<span className="hidden sm:block">` to avoid adding a flex child with implicit block display issues on mobile.

---

## Known Limitations

- TeamSwitcher is not imperatively closeable from the parent (it owns its own state). The backdrop coordination is sufficient for the current two-dropdown case. If a third coordinated dropdown were added, a shared `useSingleDropdown` hook would be the right abstraction.
- `useRememberLastTeam` fires even if the user has no-access to the board (boardId is null). This is acceptable — the teamId is still valid, and the user will be shown the access-denial state. The stored ID will still point to a team the user is a member of (RLS returns null boardId only if they lack team membership, but the `/kanban` redirect validates against `useTeams()` which already filters to the user's visible teams).

---

## Breaking Changes

None. All changes are additive. The Board button fix corrects a navigation bug.

---

## Next Steps

Reviewer: please audit for:
1. Dropdown coordination — open the switcher and user menu in sequence to confirm only one shows at a time.
2. Mobile burger Switch team section — verify it only appears on team-scoped routes with 2+ teams.
3. localStorage clear on sign-out — verify `kanban:lastTeamId` is absent after logout.
4. `/kanban` redirect priority — with 2+ teams, navigate to Team B's board, then go to `/kanban`; confirm it redirects to Team B.
5. Board button on team detail page (`/teams/[teamId]`) — confirm it navigates to `/teams/[teamId]/board`.
