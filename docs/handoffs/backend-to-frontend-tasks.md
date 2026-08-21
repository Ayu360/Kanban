# Backend → Frontend Handoff: Tasks Module (PRD 04)

**Status:** Phase 2 (backend) complete — ready for frontend integration (Phase 5).
**PRD:** `docs/prd/04-tasks.md`
**DB Handoff:** `docs/handoffs/database-to-backend-tasks.md`
**Prepared by:** Backend Engineer
**Date:** 2026-08-21

---

## Overview

The Tasks module backend is fully implemented. All repository, service, and TanStack Query hooks are in place. This document describes the complete public interface the frontend agent needs to wire into the existing Kanban UI (`src/features/kanban/`).

**Key architectural note:** Task CRUD is client-side Supabase writes per ADR-0015. There are NO Server Actions for tasks. Hooks call the service directly in the browser via the anon Supabase client + RLS.

---

## Files Created

| File | Purpose |
|---|---|
| `src/features/tasks/types/index.ts` | Domain DTOs: `Task`, `Column`, `Board`, input types, `TasksError` |
| `src/features/tasks/repositories/TasksRepository.ts` | Repository interface (swap seam — ADR-0004) |
| `src/features/tasks/repositories/SupabaseTasksRepository.ts` | Supabase implementation (browser client, RLS) |
| `src/features/tasks/services/tasksService.ts` | Business logic: validation, position, assignee guard, move check |
| `src/features/tasks/hooks/tasksQueryKeys.ts` | Centralized query key factory (ADR-0013) |
| `src/features/tasks/hooks/useBoard.ts` | Query hook — loads board + columns + tasks |
| `src/features/tasks/hooks/useCreateTask.ts` | Mutation — creates a task |
| `src/features/tasks/hooks/useUpdateTask.ts` | Mutation — edits title/description/priority/assignee/dueDate |
| `src/features/tasks/hooks/useMoveTask.ts` | Mutation — moves a task to a different column (optimistic) |
| `src/features/tasks/hooks/useDeleteTask.ts` | Mutation — hard-deletes a task |
| `src/features/tasks/hooks/index.ts` | Barrel export for all hooks |
| `docs/handoffs/backend-to-frontend-tasks.md` | This file |

---

## Type Contracts

```typescript
// src/features/tasks/types/index.ts

type TaskPriority = 'low' | 'medium' | 'high';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assigneeId: string | null;    // null = unassigned OR tombstoned (PRD 05)
  dueDate: string | null;       // ISO date string YYYY-MM-DD or null
  position: number;
  columnId: string;
  boardId: string;
  companyId: string;
  createdBy: string | null;     // null = creator was hard-deleted (PRD 05)
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
}

interface Column {
  id: string;
  boardId: string;
  title: string;
  position: number;
  tasks: Task[];                // ordered by position ASC
}

interface Board {
  id: string;
  teamId: string;
  companyId: string;
  title: string;
  columns: Column[];            // ordered by position ASC
}

// Client input types — fields NOT included are computed server-side
interface CreateTaskInput {
  title: string;                // required
  description?: string;         // optional
  columnId: string;             // required
  boardId: string;              // required
  priority?: TaskPriority;      // defaults to 'medium'
  assigneeId?: string | null;   // optional, validated server-side
  dueDate?: string | null;      // optional, ISO date
}

type UpdateTaskInput = Partial<
  Pick<Task, 'title' | 'description' | 'priority' | 'assigneeId' | 'dueDate'>
>;

interface MoveTaskInput {
  taskId: string;
  toColumnId: string;
  boardId: string;    // needed for cache invalidation — include in mutation call
}

// Error type
type TasksErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'UNAUTHENTICATED'
  | 'UNKNOWN_ERROR';

class TasksError extends Error {
  code: TasksErrorCode;
  originalError?: unknown;
}
```

---

## Repository / Service Architecture

**Seam:** `TasksRepository` (interface) → `SupabaseTasksRepository` (implementation).

**Data flow:** Hook → `TasksService` → `TasksRepository` → Supabase browser client → PostgreSQL (RLS enforced).

**Repository** handles I/O and error normalization: catches all `PostgrestError` instances, maps them to `TasksError` before returning. No Supabase types leak above this boundary. The repository also owns all auth context sourcing (`getCurrentUserContext`) and validation queries (`isAssigneeInDirectory`, `getColumnBoardId`).

**Service** owns business logic:
- Input validation (title 1–500 chars, description ≤5000, priority enum).
- Session sourcing: calls `repo.getCurrentUserContext()` (uses `auth.getUser()` — server-validated, NOT `getSession()`). `userId` and `companyId` are NEVER accepted from client form input.
- Position computation: `MAX(position) + 1` in the target column (two-step query + insert, accepted race per Phase 1 decision).
- Assignee validation: delegates to `repo.isAssigneeInDirectory()` which queries `employee_directory` view. The view is company-scoped by RLS — if the profile is from another company or does not exist, validation fails.
- Move validation: delegates to `repo.getColumnBoardId()` to check that `toColumnId.board_id` matches the task's `boardId` before hitting the DB (the consistency trigger also enforces this, but early check gives a better error message).

**Hooks** own TanStack Query integration: optimistic updates, cache invalidation. Hooks do NOT import the Supabase client — all session sourcing and I/O is delegated to the service and repository.

**Singletons:** `SupabaseTasksRepository` and `TasksService` are instantiated once per module at the hook layer (exported from `useBoard.ts`). All five hooks share the same instances. This is safe — they are stateless.

---

## Hook Signatures

### `useBoard(boardId: string | undefined)`

```typescript
import { useBoard } from '@/features/tasks/hooks';

const { board, isLoading, error } = useBoard(boardId);
// board: Board | null
// isLoading: boolean
// error: Error | null
```

- Query key: `tasksQueryKeys.list(boardId)`
- staleTime: 30 seconds
- Returns `null` when board does not exist OR caller has no RLS access
- Disabled when `boardId` is falsy
- All mutations invalidate this key on settle

---

### `useCreateTask()`

```typescript
import { useCreateTask } from '@/features/tasks/hooks';

const createTask = useCreateTask();

createTask.mutate({
  title: 'Build the login page',
  description: 'Implement the email/password sign-in form',  // optional
  columnId: '<uuid>',
  boardId: '<uuid>',
  priority: 'high',       // optional, defaults to 'medium'
  assigneeId: '<uuid>',   // optional, validated server-side
  dueDate: '2026-09-01',  // optional, ISO date
});
```

- Mutates: calls `TasksService.create()` — session is sourced inside the service via `repo.getCurrentUserContext()` (server-validated `getUser()` call)
- `company_id`, `created_by`, and `position` are NEVER passed — always computed server-side
- `onSettled`: invalidates `list(boardId)` — fires on both success and error
- Error: `createTask.error` is a `TasksError`

---

### `useUpdateTask()`

```typescript
import { useUpdateTask } from '@/features/tasks/hooks';

const updateTask = useUpdateTask();

updateTask.mutate({
  id: '<task-uuid>',
  boardId: '<board-uuid>',   // for cache invalidation
  title: 'Updated title',
  priority: 'high',
  assigneeId: '<profile-uuid>',
  dueDate: '2026-09-15',
  description: 'Updated description',
});
```

- Non-optimistic (low-frequency edits)
- Only pass fields you want to change — undefined fields are ignored
- `onSettled`: invalidates `list(boardId)` — fires on both success and error
- Assignee validated against `employee_directory` if non-null

---

### `useMoveTask()`

```typescript
import { useMoveTask } from '@/features/tasks/hooks';

const moveTask = useMoveTask();

moveTask.mutate({
  taskId: '<uuid>',
  toColumnId: '<uuid>',
  boardId: '<uuid>',
});
```

- **Optimistic**: applies `task.columnId = toColumnId` immediately on all tasks in the cached board
- `onMutate`: snapshot → targeted patch → return `{ previousBoard }`
- `onError`: rollback to snapshot
- `onSettled`: invalidate `list(boardId)`
- Position in target column is always appended (MAX+1) — fine-grained reorder is post-MVP
- Cross-board moves are rejected with `VALIDATION_ERROR` before hitting the DB

---

### `useDeleteTask()`

```typescript
import { useDeleteTask } from '@/features/tasks/hooks';

const deleteTask = useDeleteTask();

deleteTask.mutate({
  taskId: '<uuid>',
  boardId: '<uuid>',
});
```

- Hard-delete — irreversible. Show a confirmation dialog first.
- Non-optimistic — card disappears on `onSettled` refetch
- `onSettled`: invalidates `list(boardId)` — fires on both success and error
- Any team member with board access can delete any task (per PRD FR-05 / RLS)

---

## Query Key Convention

```typescript
import { tasksQueryKeys } from '@/features/tasks/hooks';

tasksQueryKeys.all                    // ['tasks']
tasksQueryKeys.lists()                // ['tasks', 'list']
tasksQueryKeys.list(boardId)          // ['tasks', 'list', { boardId }]
tasksQueryKeys.details()              // ['tasks', 'detail']
tasksQueryKeys.detail(taskId)         // ['tasks', 'detail', { id }]
```

All mutations invalidate `tasksQueryKeys.list(boardId)` on success or settle.

---

## Optimistic Move Contract

The `useMoveTask` hook implements the exact pattern from `src/api/board.ts` `useMoveTopic`:

```typescript
onMutate: async (variables) => {
  const queryKey = tasksQueryKeys.list(boardId);
  await queryClient.cancelQueries({ queryKey });          // prevent stale clobber
  const previousBoard = queryClient.getQueryData(queryKey); // snapshot
  queryClient.setQueryData(queryKey, (old) => {
    const targetColumn = old.columns.find((c) => c.id === toColumnId);
    const toPosition = (targetColumn?.tasks.length ?? 0) + 1;
    return applyOptimisticMove(old, taskId, toColumnId, toPosition); // physical extract + append
  });
  return { previousBoard };                               // rollback context
},
onError: (_err, variables, context) => {
  queryClient.setQueryData(                               // rollback
    tasksQueryKeys.list(variables.boardId),
    context.previousBoard
  );
},
onSettled: (_data, _err, variables) => {
  queryClient.invalidateQueries({                         // authoritative refetch
    queryKey: tasksQueryKeys.list(variables.boardId),
  });
},
```

**Reviewer R5 compliance:** The rollback is a targeted patch (restoring the snapshot board object), not a full recomputation. `applyOptimisticMove` physically moves the task between column arrays: it removes the task from the source column's `tasks` array and appends it to the target column's `tasks` array (with `columnId` and an approximate `position` updated on the task object). It does NOT attempt to re-sort tasks within the target column — the final ordering is resolved by `onSettled` invalidation. All operations are immutable; the input board is never mutated.

All mutations (create, update, delete) now invalidate on `onSettled` rather than `onSuccess` to ensure the cache is never left stale after a mid-flight network failure.

---

## Error Taxonomy → UI Messages

| `TasksErrorCode` | Cause | Suggested UI copy |
|---|---|---|
| `VALIDATION_ERROR` | Empty title, description too long, bad priority, cross-company assignee, cross-board move | Show the error message from `TasksError.message` — it is user-safe |
| `NOT_FOUND` | Task deleted by another user, board not accessible | "This item no longer exists. The board has been refreshed." |
| `FORBIDDEN` | RLS block — user lacks board access | "You don't have permission to perform this action." |
| `UNAUTHENTICATED` | Missing session at mutation time | "Please sign in to continue." |
| `CONFLICT` | Concurrent write edge case (reserved for future use) | "A conflict occurred. Please refresh and try again." |
| `UNKNOWN_ERROR` | Network error, unexpected DB error | "Something went wrong. Please try again." |

---

## Tombstone Rendering Contract

**`task.assigneeId === null`** — two cases, same rendering:
- Task was never assigned.
- Task assignee was hard-deleted (PRD 05 `ON DELETE SET NULL`).
- Render: no assignee shown on the task card. Same UX as never-assigned. MVP does not distinguish these two cases.

**`task.createdBy === null`** — creator was hard-deleted:
- Render: `[Deleted User]` with muted styling if creator attribution is surfaced.
- In MVP, creator is NOT prominently shown on task cards. Only render this in detail views or metadata sections if added.
- Match the Teams tombstone pattern: `[Deleted User]` with `text-gray-400` or equivalent muted styling.

---

## Assignee Picker Guidance

Use the existing `useEmployeeDirectory` hook from `src/features/employees/hooks/useEmployeeDirectory.ts`:

```typescript
import { useEmployeeDirectory } from '@/features/employees/hooks/useEmployeeDirectory';

const { employees } = useEmployeeDirectory();
// employees: Employee[] — filtered by company via RLS on employee_directory view
// Each: { id, displayName, role }
```

The view already excludes deactivated employees (handled at the DB layer). No additional client-side filtering for status is needed unless you want to show a "Deactivated" indicator for existing task assignees (tasks can still hold `assigneeId` pointing to a deactivated employee — they just cannot be re-selected).

**Deactivated existing assignee:** If `task.assigneeId` is non-null but the profile is not in `employee_directory` (deactivated after assignment), the task card should show the name with a visual "Deactivated" indicator. The name lookup will need to come from a separate profile fetch if not already in cache.

---

## Delete Confirmation Guidance

Reuse the existing `ConfirmDialog` from `src/features/teams/components/ConfirmDialog.tsx`:

```typescript
<ConfirmDialog
  open={showDeleteConfirm}
  title="Delete task?"
  message="This task will be permanently deleted and cannot be recovered."
  confirmLabel="Delete"
  onConfirm={() => deleteTask.mutate({ taskId, boardId })}
  onCancel={() => setShowDeleteConfirm(false)}
/>
```

---

## Column-Edit Guidance (Reviewer Y1)

**Do NOT implement `useUpdateColumn`.** Column editing is explicitly out of PRD 04 scope (per PRD Non-Goals: "Custom column creation or reordering — columns are seeded at team creation and are not editable in MVP").

During Phase 5 (frontend wiring):
- Remove any dead column-edit paths from `EditModal` and `KanbanDashBoard` components.
- Remove `useUpdateColumn` from `src/api/board.ts` (in Phase 6 fake-API excision, or in Phase 5 if the component cleanup happens there).
- Do NOT add column rename/delete UI.

---

## Route Guidance

New board route: `/teams/[teamId]/board`

The frontend agent should create a new App Router page at `src/app/teams/[teamId]/board/page.tsx` that:
1. Reads `teamId` from the URL params.
2. Uses an existing Teams hook (or server-side fetch) to resolve `boardId` from `teamId` (each team has exactly one board, seeded at team creation via `create_team_with_board` RPC).
3. Passes `boardId` to `useBoard(boardId)`.

The existing `/kanban` page can be redirected or deprecated per frontend decision. Do NOT delete `src/features/kanban/` components — the frontend agent will rewire them.

---

## Anti-Patterns / Gotchas

1. **Never pass `company_id` or `created_by` from client form input.** These are always sourced from the authenticated session inside `TasksService.create()` via `repo.getCurrentUserContext()` (which calls `auth.getUser()`, server-validated). Passing them as part of `CreateTaskInput` from a form would be silently ignored — but the pattern is wrong and must not be established. Also: do NOT call `getSession()` for auth context in these hooks — `getSession()` is client-cached and does not validate the token against the server. The repository's `getCurrentUserContext()` uses `getUser()` instead.

2. **Never trust `assigneeId` from the client without server-side validation.** `TasksService` always queries `employee_directory` before writing `assigneeId`. This is the sole cross-company enforcement until a DB trigger is added. Do not add any shortcut path that skips this check.

3. **Do not implement a position RPC.** Position is always `MAX(position) + 1`, computed in `TasksService`. Temporary ties from concurrent inserts are cosmetic and acceptable (resolve on `onSettled` invalidation).

4. **Do not create Server Actions for task CRUD.** Task operations are client-side writes (ADR-0015). Any mutation hooks for tasks must call the service directly via the browser Supabase client, not via a Server Action.

5. **Do not delete `src/lib/fakeApi.ts` or `src/api/board.ts` in Phase 5.** This is Phase 6 excision work — the frontend agent owns that cleanup task. Deleting them now would break the existing kanban page before the real hooks are wired.

6. **The `boardId` field on `MoveTaskInput`, `DeleteTaskVariables`, and `UpdateTaskVariables` is required.** It is used for cache invalidation, not for the DB write. Always include it when calling move/delete/update mutations.

---

## Known Limitations (Phase 1 / MVP)

1. **Position = append-only.** Tasks always append to the end of the target column. Within-column drag-to-reorder is post-MVP.

2. **Concurrent insert race.** Two simultaneous creates in the same column produce a temporary position tie. Resolves on `onSettled` refetch. Cosmetic, accepted.

3. **No assignee DB trigger.** Cross-company `assigneeId` writes are blocked by the `TasksService.validateAssigneeInDirectory()` guard only. A DB trigger (`check_task_assignee_same_company`) should be added before multi-tenancy is enabled. See handoff Known Limitation #5 for the concrete trigger shape.

4. **No real-time sync.** Supabase Realtime for collaborative board updates is post-MVP. Boards do not update live when another user moves a card.

5. **No task search.** Full-text search is post-MVP.

---

## Integration Checklist for Frontend Agent

- [ ] Replace `useBoard(userId)` from `src/api/board.ts` with `useBoard(boardId)` from `src/features/tasks/hooks`.
- [ ] Replace `useMoveTopic()` with `useMoveTask()` (same optimistic contract; different identifier field `taskId` vs `topicId`).
- [ ] Replace `useUpdateTopic()` with `useUpdateTask()`.
- [ ] Remove `useUpdateColumn()` entirely (column editing is out of scope).
- [ ] Wire `useCreateTask()` to the "add card" modal (replaces `setLocalTopics` in `src/features/kanban/index.tsx`).
- [ ] Wire `useDeleteTask()` to the delete action in `EditModal` (behind a `ConfirmDialog`).
- [ ] Add priority selector, assignee picker, and due date picker to `EditModal`.
- [ ] Wire `useEmployeeDirectory()` to the assignee picker in `EditModal`.
- [ ] Create route `/teams/[teamId]/board` that resolves `boardId` from `teamId`.
- [ ] Render `[Deleted User]` for `task.createdBy === null` in any creator attribution UI.
- [ ] Render no assignee for `task.assigneeId === null` (same UX as never-assigned).
- [ ] Phase 6 (separate task): delete `src/lib/fakeApi.ts` and `src/api/board.ts` after all imports are excised.
