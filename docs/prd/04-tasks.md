# Tasks — Product Requirements Document

---

# Overview

The Tasks module replaces the existing in-memory fake API with a real Supabase-backed data layer while preserving the full Kanban board experience that already exists in `src/features/kanban/`. It covers creating, reading, updating, moving (across columns), and deleting tasks. The drag-and-drop and mobile move-modal interactions already implemented in the demo are preserved. The "add card" client-only state flow is replaced with a real persisted mutation. Task access is scoped by team membership via RLS: employees see only tasks on boards for teams they belong to; company admins see all tasks in their company; platform admins see all tasks everywhere.

This module depends on Authentication (01-authentication.md), Teams (02-teams.md), and Employees (03-employees.md).

---

# Goals

1. Tasks are persisted in Supabase and survive page reloads.
2. The existing drag-and-drop column-change and optimistic-update pattern (modeled on `useMoveTopic` in `src/api/board.ts`) is preserved and wired to real Supabase writes.
3. The "add card" flow creates a real database row instead of a local-state entry.
4. Employees only see tasks in teams they belong to, enforced by RLS.
5. Tasks carry all required fields: title, description, status (column), priority, assignee, due date, and audit timestamps.
6. The repository seam is in place: `TasksRepository` interface with `SupabaseTasksRepository` as the implementation. `src/lib/fakeApi.ts` is fully deleted as part of this work.

---

# Non Goals

- Comments on tasks (post-MVP).
- File attachments (post-MVP).
- Task activity log / audit trail (post-MVP).
- Custom column creation or reordering — columns are seeded at team creation and are not editable in MVP.
- Sub-tasks or task dependencies (post-MVP).
- Cross-team task views ("all tasks assigned to me across all teams") — post-MVP.
- Real-time collaborative updates (multiple users seeing each other's drags in real time) — post-MVP.
- Bulk task operations (bulk delete, bulk move) — post-MVP.
- Task templates — post-MVP.
- Time tracking — post-MVP.

---

# User Stories

1. As a team member, I can view the Kanban board for my team so that I can see all tasks and their current status.
2. As a team member, I can create a new task in a column so that work is captured in the board.
3. As a team member, I can edit a task's title and description so that details stay accurate.
4. As a team member, I can drag a task card to a different column so that its status is updated.
5. As a team member on mobile, I can use the move modal to move a task to a different column since drag-and-drop is not available on touch devices.
6. As a team member, I can set a task's priority (Low, Medium, High) so that urgency is visible at a glance.
7. As a team member, I can assign a task to an employee in the company so that ownership is clear.
8. As a team member, I can set a due date on a task so that deadlines are tracked.
9. As a team member, I can delete a task so that completed or cancelled work is removed.
10. As an employee, I cannot see or access tasks in teams I am not a member of.
11. As a company admin, I can see all tasks across all teams in my company.
12. As a platform admin, I can see all tasks across all companies.

---

# Functional Requirements

## FR-01: Board and Task Loading

- The Kanban board page loads the board for the active team, including all columns and tasks within those columns.
- The query for board data is fetched via a TanStack Query hook (`useBoard`) backed by `TasksRepository.getBoardWithDetails(boardId)`.
- The board ID is derived from the team context (the URL, e.g., `/board/[boardId]` or `/teams/[teamId]/board`).
- Loading state: the existing spinner/skeleton UI is preserved. The page does not flash blank content.
- Error state: the existing error display is preserved.
- Empty column state: a column with no tasks shows an empty state prompt to add the first card.

## FR-02: Task Creation (Add Card)

- The "add card" flow opens via an existing `AddCardModal` component triggered from the column header or footer.
- The modal accepts a title (required) and description (optional).
- On submit, a `useCreateTask` mutation hook is called. The mutation calls `tasksService.create()` which calls `TasksRepository.create()`.
- The new task is inserted with: `title`, `description` (nullable), `column_id` (the column where the card was initiated), `board_id`, `company_id` (from the user's JWT), `created_by` (the current user's `profile_id`), `priority` defaulting to `'medium'`, `position` set to the end of the column's task list, and `due_date` and `assignee_id` both null.
- After a successful insert, the task list is invalidated and refetched. No local-state `localTopics` array is needed after this migration: the real repository is the source of truth.
- The existing `localTopics` state in `src/features/kanban/index.tsx` is removed once the real mutation is in place.
- Creation is a client-side Supabase write (anon key + RLS). It does not require a Server Action.

## FR-03: Task Editing

- Clicking a task card opens the `EditModal` (already exists) populated with the task's current `title` and `description`.
- On save, `useUpdateTask` is called. The mutation calls `tasksService.update()` → `TasksRepository.update()`.
- The update persists `title`, `description`, `priority`, `assignee_id`, and `due_date`. `updated_at` is updated by the database trigger.
- After save, the task list is invalidated and refetched, or the task detail is updated optimistically. Non-optimistic invalidation is acceptable for edits (low-frequency operation).
- Edit is a client-side Supabase write.

## FR-04: Task Move (Column Change)

- Dragging a task card to a different column (desktop) or using the move modal (mobile) calls `useMoveTopic`, which calls `tasksService.move()` → `TasksRepository.move(taskId, toColumnId, toPosition)`.
- The optimistic update pattern from the existing `useMoveTopic` hook in `src/api/board.ts` is preserved exactly: snapshot the cache → apply optimistic update (`setQueryData`) → on error rollback to snapshot → on settled invalidate.
- After migration, `useMoveTopic` calls `TasksRepository.move()` instead of `moveTopicApi` from `fakeApi.ts`. The optimistic shape (updating `columnId` on the task in the cached board) stays the same.
- The `position` field within the target column is set to the end of that column's task list on move in MVP. Fine-grained reorder within a column is post-MVP.
- Move is a client-side Supabase write.

## FR-05: Task Deletion

- A "Delete" action is accessible from the task card or from the `EditModal`.
- A confirmation dialog is shown before deletion: "Delete this task? This cannot be undone."
- On confirmation, `useDeleteTask` is called. The task row is hard-deleted.
- After deletion, the task list is invalidated and the card disappears from the board.
- Deletion is a client-side Supabase write (RLS permits the task creator or any team member with write access to delete; in MVP any authenticated team member can delete any task on a board they have access to — per ADR-0009 enforcement is team-scoped).

## FR-06: Task Priority

- Tasks carry a `priority` field: `'low'`, `'medium'`, or `'high'`.
- Priority is settable in the `EditModal` via a select or segmented control.
- Priority is displayed visually on the task card (color indicator or label).
- Default on creation: `'medium'`.

## FR-07: Task Assignee

- Tasks carry an optional `assignee_id` (a `profile_id` from the `profiles` table).
- The assignee is selectable from a list of active employees in the company (sourced from the employees data layer).
- The assignee's display name is shown on the task card when set.
- Deactivated employees can be shown as the assignee on existing tasks (with a "Deactivated" indicator) but cannot be selected as an assignee for new or updated tasks.
- **Deleted employees** (hard-deleted per PRD 05) leave the task with `assignee_id = NULL` via the FK `ON DELETE SET NULL`. In MVP the task card simply shows no assignee (same as never-assigned); the task is not cascade-deleted, hidden, or auto-reassigned. Admin can re-assign it manually via the `EditModal`.
- Assignee is set in the `EditModal`.

## FR-08: Task Due Date

- Tasks carry an optional `due_date` (a date, not a datetime).
- Due date is set via a date picker in the `EditModal`.
- Due date is displayed on the task card when set.
- Past due dates are displayed with a visual indicator (e.g., red text) to signal overdue status.

## FR-09: Access Scoping

- An employee navigating to a board for a team they are not a member of receives an empty or forbidden response. RLS ensures no task data is returned.
- The frontend handles the empty/forbidden state with a user-facing message ("You do not have access to this board").
- Company admins see all boards and tasks in their company regardless of team membership.
- Platform admins see all boards and tasks everywhere.

## FR-10: Migration — Removal of Fake API

- `src/lib/fakeApi.ts` is deleted in full as part of this feature's PR.
- `src/api/board.ts` is replaced by feature-first hooks under `src/features/tasks/hooks/` (e.g., `useBoard`, `useCreateTask`, `useMoveTask`, `useUpdateTask`, `useDeleteTask`).
- All imports of `fakeApi.ts` across the codebase are removed. The TypeScript build must complete without errors after this deletion.
- The `LocalTasksRepository` intermediate step (described in PROJECT_CONTEXT migration plan step 1) may be introduced as a transient implementation if needed to de-risk the migration, but must not remain in the codebase after this feature merges. The final state is `SupabaseTasksRepository` as the sole implementation.

---

# Business Rules

- Per ADR-0006, every `tasks` row carries `company_id NOT NULL`. The `company_id` is taken from the current user's JWT claim on insert — it is not supplied by the client explicitly. Per ADR-0006, this column is present on every business table.
- Per ADR-0009, the RLS policy on `tasks` uses a three-tier check: platform admin bypass, company admin company-scoped bypass, and team membership filter via `team_members`. Tasks are accessible if the user belongs to the team that owns the board that contains the column that holds the task.
- Per ADR-0004, the `TasksRepository` interface is the swap seam. `SupabaseTasksRepository` is the only concrete implementation in MVP. The composition root (`src/lib/container.ts`) injects it. No Supabase types appear above the repository layer.
- Per ADR-0005, task list and board data live exclusively in TanStack Query. No task state is stored in Redux.
- Per ADR-0013, query keys follow `[feature, entity, scope, params]`: e.g., `['tasks', 'list', { boardId }]`, `['tasks', 'detail', { id }]`. The existing `boardKeys` in `src/api/board.ts` are replaced with this convention.
- Per ADR-0015, task CRUD operations are client-side Supabase writes (anon key + RLS). No Server Action is required for task create, update, move, or delete. Server Actions are not used for task operations in MVP.
- Columns are not editable in MVP. The `columns` table is written to only at team creation time (seeded with three fixed columns). No column rename, add, or delete flow exists in this module.
- The optimistic update pattern for task move is the reference implementation as documented in PROJECT_CONTEXT section 12 and ADR-0013. New optimistic mutations in other features should follow this shape.
- `created_by` is set to the current user's `profile_id` at insert time. It is immutable after creation by application code. If the creator is hard-deleted per PRD 05, `created_by` becomes NULL via the FK `ON DELETE SET NULL`; the task persists as a tombstone-safe row. Any UI surfacing creator attribution (currently rare in MVP) renders `[Deleted User]` for NULL creators, matching the Teams tombstone pattern.

---

# Edge Cases

1. **Network failure during optimistic task move:** The `onError` rollback in `useMoveTopic` restores the previous board state from the cache snapshot. The user sees the task return to its original column. A toast or error message informs them that the move failed.
2. **Two users move the same task simultaneously:** Last write wins. The `onSettled` invalidation refetches the authoritative server state, resolving the conflict. No concurrent editing UI is provided in MVP.
3. **Task move to the same column it is already in:** The UI prevents this at the drag-and-drop level (the task position does not change if dropped in the same column). The repository can treat this as a no-op.
4. **Creating a task in a column on a board the user has no access to:** RLS rejects the insert. The repository catches the error and normalizes it to a permission error. The UI displays an error message.
5. **Deleting a task that is currently being edited in another session:** The editor session's save will fail with a "row not found" error. The repository normalizes this; the UI shows an error and refreshes the board data.
6. **Assigning a task to a deactivated employee:** The assignee picker excludes deactivated employees. If a task already has a deactivated assignee (deactivated after assignment), the task card shows their name with a visual "Deactivated" marker. No automatic unassignment occurs.
7. **Board not found for a given `boardId` URL:** The query returns null. The page shows a "Board not found" state.
8. **Employee visits the board URL for a team they are not a member of:** RLS returns an empty result for the board query. The frontend shows "You do not have access to this board" rather than a loading spinner or 404.
9. **`fakeApi.ts` import missed during cleanup:** A TypeScript compile error surfaces the forgotten import. The PR must not merge with TypeScript errors or remaining imports of `fakeApi`.
10. **Task position ordering on move:** When a task is moved to a new column, it is placed at the end (highest position value). The displayed order within the column matches the `position` field sort. No position gaps or conflicts are introduced because the move sets position to `MAX(existing positions) + 1` in the target column.

---

# UI Requirements

- The Kanban board UI in `src/features/kanban/` is the starting point and must be preserved in appearance and interaction. No visual regression from the existing demo is acceptable.
- Drag-and-drop on desktop (via `@dnd-kit`) and the move modal on mobile are both preserved.
- Task cards display: title, description excerpt (if any), priority indicator, assignee name/avatar (if set), due date (if set, with overdue styling for past dates).
- **Tombstone-safe assignee/creator:** when an employee is hard-deleted, tasks they created or were assigned to persist (FK ON DELETE SET NULL). A NULL `assignee_id` renders as no assignee (same UX as never-assigned — MVP does not surface historical assignment). If any UI surfaces creator attribution (e.g. future EditModal metadata or hover states), a NULL `created_by` renders `[Deleted User]` with muted styling, matching the Teams tombstone pattern. Creator attribution is not prominently displayed on task cards in MVP.
- The `AddCardModal` is unchanged in appearance. Its behavior changes from `setLocalTopics` to a real `useCreateTask` mutation.
- The `EditModal` is extended to include controls for priority (select), assignee (employee picker), and due date (date picker) in addition to the existing title and description fields. A delete button is also added.
- Column headers show the column title and task count.
- The "add card" button appears at the bottom of each column.
- Loading and error states on the board page are preserved from the existing implementation.
- The board page title reflects the team name (fetched alongside the board).
- Per ADR-0003, frontend access checks (hiding the board from non-members) are UX only. The database enforces the real restriction.

---

# Backend Requirements

- `TasksRepository` interface in `src/features/tasks/repositories/TasksRepository.ts`. Methods include at minimum: `getBoardWithDetails(boardId)` returns the board with its columns and tasks; `create(input)` returns the new task; `update(id, input)` returns the updated task; `move(id, toColumnId, toPosition)` returns the updated task; `delete(id)` returns void.
- `SupabaseTasksRepository` in `src/features/tasks/repositories/SupabaseTasksRepository.ts` implements the interface using the browser Supabase client.
- `TasksService` in `src/features/tasks/services/tasksService.ts` wraps the repository, enforces business rules (e.g., validates that the target column exists and belongs to the same board on a move), and contains the position calculation logic for new tasks and moved tasks.
- TanStack Query hooks in `src/features/tasks/hooks/`: `useBoard` (board with details, query key `['tasks', 'list', { boardId }]`), `useCreateTask`, `useUpdateTask`, `useMoveTask`, `useDeleteTask`.
- `useMoveTask` implements the optimistic update pattern: snapshot → optimistic setQueryData → onError rollback → onSettled invalidate. This is the reference pattern from `src/api/board.ts` `useMoveTopic`, applied to the real repository.
- After create, update, or delete, invalidate `['tasks', 'list', { boardId }]`.
- Per ADR-0004, all Supabase errors (network errors, RLS rejections, constraint violations) are caught at the repository layer and normalized to the project error type before surfacing to the service or hook.
- The composition root (`src/lib/container.ts`) wires `SupabaseTasksRepository` as the `TasksRepository` implementation.
- `src/api/board.ts` is deleted and replaced by the feature-first hooks above. All consumers of the old hooks are updated to import from `src/features/tasks/hooks/`.

---

# Database Requirements

Described in prose only. SQL lives in `supabase/migrations/`.

- A `tasks` table holds task records. Each row carries: `id` (UUID, primary key), `column_id` (UUID, non-nullable, foreign key to `columns`), `board_id` (UUID, non-nullable, foreign key to `boards`), `company_id` (UUID, non-nullable, foreign key to `companies` — per ADR-0006), `title` (text, non-nullable), `description` (text, nullable), `priority` (text, constrained to `'low'`, `'medium'`, `'high'`, defaults to `'medium'`), `assignee_id` (UUID, nullable, foreign key to `profiles` with `ON DELETE SET NULL`), `due_date` (date, nullable), `position` (integer, non-nullable), `created_by` (UUID, **nullable**, foreign key to `profiles` with `ON DELETE SET NULL`), `created_at` (timestamp, non-nullable, set by default), `updated_at` (timestamp, non-nullable, updated by a database trigger on every row change).
- **Tombstone-first FK behavior (per PRD 05):** Both `assignee_id` and `created_by` reference `profiles.id` with `ON DELETE SET NULL`. When an employee is hard-deleted via the PRD 05 lifecycle deletion flow, all their referenced tasks persist with the relevant column set to NULL. Tasks are never cascade-deleted. This mirrors the tombstone contract established for `team_members.profile_id` and `boards.created_by`. Application code treats `created_by` as write-once at insert; the NULL transition is only ever triggered by the deletion cascade, not by an UPDATE.
- The `columns` table (defined in the Teams module) carries the board's ordered column list. No columns table changes are needed here beyond confirming that `columns` rows exist before tasks can be inserted.
- The `boards` table (defined in the Teams module) is the parent of `columns`. No boards table changes are needed here.
- RLS on `tasks`: three-tier policy per ADR-0009. The policy joins `tasks → columns → boards` to reach `boards.team_id`, then checks: (1) `is_platform_admin = true`, or (2) `tasks.company_id = jwt.company_id AND jwt.role = 'admin'`, or (3) `EXISTS (SELECT 1 FROM team_members WHERE profile_id = jwt.sub AND team_id = boards.team_id)`. This policy applies to SELECT, INSERT, UPDATE, and DELETE.
- A database trigger sets `updated_at = now()` on every UPDATE to a `tasks` row.
- Indexes required for RLS performance: `team_members(profile_id, team_id)` (defined in Teams module), `boards(team_id)` (defined in Teams module), `tasks(board_id)`, `tasks(column_id)`, `tasks(assignee_id)`.
- `company_id` on `tasks` is derived from the board's `company_id` at insert time. The repository insert sets it explicitly from the current user's JWT claim, maintaining consistency without requiring a join.

---

# Validation Rules

- Task title: required, non-empty after trimming whitespace, maximum 500 characters. Validated client-side (UX) and enforced by a NOT NULL + CHECK constraint at the database level.
- Task description: optional, maximum 5000 characters if provided.
- Priority: must be one of `'low'`, `'medium'`, `'high'`. The database `CHECK` constraint is the enforcement layer. The client-side picker only offers these three values.
- `assignee_id`: if provided, must be a valid `profile_id` in the same company as the task. Validated by the foreign key constraint. The assignee picker only shows active employees in the same company.
- `due_date`: if provided, must be a valid date. The client date picker enforces this. No constraint that due date must be in the future (backlogged items may be added with past dates intentionally).
- `column_id` on create: must exist and belong to the board being written to. Validated in `TasksService` before the repository insert.
- `column_id` on move: the target column must belong to the same board as the task's current board. Validated in `TasksService`.
- `created_by`: set by the Server (the current user's `profile_id` from the session). The client does not supply this field; the repository derives it from the authenticated session.
- `company_id`: set by the repository from the authenticated user's JWT claim. The client does not supply this field.

---

# Acceptance Criteria

1. A team member opens the board. All tasks previously created (in a prior session) are displayed in the correct columns and in position order. The page does not flash an empty state before loading.
2. A team member opens the "Add card" modal for the "Todo" column, enters a title and description, and submits. The card appears in the "Todo" column immediately (optimistic or after refetch). On page reload, the card is still present.
3. A team member drags a task from "Todo" to "In Progress." The card moves immediately (optimistic update). On page reload, the task is in "In Progress." If the network call fails, the card returns to "Todo" and an error message is shown.
4. A team member on mobile uses the move modal to move a task from "In Progress" to "Done." After confirmation, the task appears in "Done."
5. A team member opens the `EditModal` for a task, changes the title, sets priority to "High," assigns the task to Alice, and sets a due date. On save, the card reflects the new title, shows a "High" priority indicator, shows Alice's name as assignee, and shows the due date. On page reload, all changes persist.
6. A team member deletes a task. After confirmation, the card is removed from the board. On page reload, the card does not reappear.
7. An employee who is not a member of Team B navigates to Team B's board URL. The board query returns no data. The page shows "You do not have access to this board." No task data from Team B is visible in the browser network responses.
8. A company admin opens the board for any team in their company, including teams they are not a member of. All tasks are visible.
9. `src/lib/fakeApi.ts` does not exist in the repository after this feature merges. `src/api/board.ts` does not exist. The TypeScript build completes without errors.
10. The `TasksRepository` interface is defined. `SupabaseTasksRepository` implements it. The composition root in `src/lib/container.ts` injects `SupabaseTasksRepository` as the `TasksRepository` implementation. No component or hook imports the Supabase client directly.

---

# Dependencies

- Authentication module (01-authentication.md) must be complete. `useCurrentUser()` and the Supabase session must be available.
- Teams module (02-teams.md) must be complete. `boards` and `columns` rows must exist before tasks can be inserted.
- Employees module (03-employees.md) must be complete for the assignee picker to query active employees.
- Employee Lifecycle & Deletion module (05-employee-lifecycle-deletion.md) must be complete. The tombstone-first FK pattern (`ON DELETE SET NULL` on `profiles.id` references) established there is the contract this module follows for `tasks.assignee_id` and `tasks.created_by`.
- Database migration creating the `tasks` table with all columns, constraints, RLS policies, indexes, and the `updated_at` trigger must be deployed.
- `@dnd-kit/core` is already installed; no new DnD dependency is needed.

---

# Future Enhancements

- Comments on tasks (requires a `comments` table and a new feature module).
- File attachments (requires Supabase Storage integration).
- Task activity log / audit trail.
- Custom and editable columns per board.
- Fine-grained within-column task reordering (drag to a specific position rather than always appending to the end).
- Cross-team task view: "all tasks assigned to me."
- Real-time collaborative updates via Supabase Realtime channels, exposed through an abstract `subscribe` method on `TasksRepository`.
- Sub-tasks and task dependencies.
- Bulk operations: bulk move, bulk delete, bulk assign.
- Task search across all accessible boards.
- Time tracking per task.
- Task templates for repeating work.
