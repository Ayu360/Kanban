# ADR 0013: Query Key Conventions and Invalidation

**Status:** Accepted — 2026-08-02

## Context

TanStack Query keys are strings-of-record for the cache. Inconsistent keys produce cache misses, redundant network calls, and mutations that don't invalidate what they should. Without a convention, every hook author invents their own key shape and things drift.

The existing `src/api/board.ts` already uses TanStack Query with a good optimistic-update pattern in `useMoveTopic` but has no repository-wide key convention.

## Decision

### Key shape

All query keys are arrays of the shape:

```
[feature, entity, scope, params]
```

Examples:
- `['tasks', 'list', { boardId }]`
- `['tasks', 'detail', { id }]`
- `['teams', 'list', { companyId }]`
- `['teams', 'detail', { id }]`
- `['auth', 'profile']`
- `['employees', 'list', { companyId }]`

Positions:
1. `feature` — the feature slice (`'tasks'`, `'teams'`, `'employees'`, `'auth'`).
2. `entity` — a stable name for the data shape (`'list'`, `'detail'`, `'stats'`).
3. `scope` (optional) — narrower category if needed.
4. `params` (optional) — an object literal of the query parameters.

`params` is always an object literal (not positional args) so field ordering is stable and diffs are readable.

### Invalidation

- **Default:** coarse invalidation by feature prefix. After mutating a task: `queryClient.invalidateQueries({ queryKey: ['tasks'] })`. This is correct for low-frequency mutations and avoids surgical-cache-update bugs.
- **High-frequency mutations (DnD, autosave):** use optimistic updates with snapshot + rollback, following the shape of the existing `useMoveTopic` hook in `src/api/board.ts` as the template:
  - `onMutate`: cancel in-flight queries, snapshot previous cache, apply optimistic update via `setQueryData`.
  - `onError`: restore snapshot.
  - `onSettled`: invalidate to reconcile with server truth.

### Where hooks live

Under `features/<feature>/hooks/`, one hook per operation:
- `useTasks(boardId)` — read
- `useCreateTask()` — mutation
- `useMoveTask()` — mutation with optimistic update

No god-hooks that return every operation for a feature.

## Consequences

- **Positive:** Consistent keys mean invalidation just works.
- **Positive:** Reviewers can spot bad keys immediately.
- **Positive:** The `useMoveTopic` pattern is a concrete template contributors can copy.
- **Negative:** Coarse invalidation over-fetches slightly. Acceptable and preferable to surgical bugs.
- **Negative:** Params object identity matters for React re-renders; consumers must memoize params if they pass objects inline. Standard TanStack caveat.

## Alternatives considered

- **String keys ('tasks:list:boardId=1').** Rejected: fragile, no structure, hard to invalidate by prefix.
- **Per-feature key factories.** Compatible with this ADR — a feature may export `taskKeys.list(boardId)` etc. that produces the standard shape. Encouraged but not mandatory.
