# ADR 0005: TanStack Query for Server State, Redux for UI State

**Status:** Accepted — 2026-08-02

## Context

The codebase already includes both TanStack Query (5.90) and Redux Toolkit (2.11). Without a clear rule, the two tools drift into overlap: server data ends up cached in Redux slices, network calls end up in thunks, and cache invalidation lives in two places. This is a well-known anti-pattern that leads to stale data, duplicated logic, and race conditions.

## Decision

Two tools, two responsibilities, no overlap:

- **TanStack Query** owns **all server state**: task lists, board data, teams, current-user profile, everything fetched from Supabase. All caching, refetching, invalidation, and optimistic updates happen here.
- **Redux Toolkit** owns **all UI state**: modal open/closed, active filters, drag preview, sidebar collapsed, theme. Slices per concern (`uiSlice`, `filterSlice`, `themeSlice`). No god slice.

Prohibited:
- Server data in Redux (no `tasksSlice` holding fetched tasks).
- Network I/O in Redux thunks.
- Redux `authSlice` after Supabase Auth lands (see ADR-0012).

## Consequences

- **Positive:** One owner per data category. Cache behavior is predictable.
- **Positive:** Both tools stay in their zone of strength.
- **Negative:** Contributors coming from Redux-heavy backgrounds must resist the urge to `dispatch(setTasks(...))`. Requires PR-review discipline.

## Alternatives considered

- **Redux for everything (with RTK Query).** Rejected: TanStack Query has better ergonomics for this app's mutation patterns (optimistic updates, dependent queries) and is already installed and in use.
- **TanStack Query for everything (state stored in the query cache).** Rejected: awkward for pure UI state (modals, filters) that has no fetch semantics.
