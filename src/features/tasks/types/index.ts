/**
 * Domain DTOs for the tasks feature.
 *
 * These types cross the repository boundary and are the canonical shape that
 * services, hooks, and components consume. No Supabase-specific types appear
 * here — the repository layer normalizes them before returning (ADR-0004).
 *
 * Key invariants:
 *   - task.assigneeId === null means unassigned OR the assignee was hard-deleted
 *     (tombstone-first per PRD 05). Both render identically in MVP: no assignee shown.
 *   - task.createdBy === null means the creator was hard-deleted. Render "[Deleted User]"
 *     if creator attribution is ever surfaced in UI (not prominent on task cards in MVP).
 *   - position is managed client-side via MAX(position)+1 in the target column.
 *   - company_id, created_by, and position are NEVER accepted from client input;
 *     they are always computed in TasksService / derived from the authenticated session.
 */

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export type TaskPriority = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Core DTOs
// ---------------------------------------------------------------------------

/**
 * A single task card. Maps 1:1 to a public.tasks row after normalization.
 *
 * Tombstone notes:
 *   assigneeId: null = unassigned or tombstoned (PRD 05 ON DELETE SET NULL)
 *   createdBy: null = creator was hard-deleted (PRD 05 ON DELETE SET NULL)
 */
export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  /** Profile ID of the assigned employee. null = unassigned or tombstoned. */
  assigneeId: string | null;
  /** ISO date string (YYYY-MM-DD). null = no due date. */
  dueDate: string | null;
  position: number;
  columnId: string;
  boardId: string;
  companyId: string;
  /** Profile ID of the user who created this task. null = creator was hard-deleted. */
  createdBy: string | null;
  /** ISO timestamp string. */
  createdAt: string;
  /** ISO timestamp string. Auto-updated by DB trigger on every UPDATE. */
  updatedAt: string;
}

/**
 * A board column, with its tasks embedded.
 * The tasks array is ordered by position ASC as returned by getBoardWithDetails.
 */
export interface Column {
  id: string;
  boardId: string;
  title: string;
  position: number;
  tasks: Task[];
}

/**
 * A Kanban board, with its columns (and their tasks) embedded.
 * Returned by getBoardWithDetails — a single round-trip that loads the full board.
 */
export interface Board {
  id: string;
  teamId: string;
  companyId: string;
  title: string;
  columns: Column[];
}

// ---------------------------------------------------------------------------
// Input DTOs — accepted from client
// ---------------------------------------------------------------------------

/**
 * Input for creating a new task.
 *
 * Fields NOT accepted from the client (always computed server-side):
 *   - company_id  — derived from JWT app_metadata.company_id
 *   - created_by  — derived from auth.uid()
 *   - position    — computed as MAX(position)+1 in the target column by TasksService
 */
export interface CreateTaskInput {
  title: string;
  description?: string;
  columnId: string;
  boardId: string;
  /** Defaults to 'medium' if omitted. */
  priority?: TaskPriority;
  /** Profile ID of the assigned employee. Optional; validated server-side. */
  assigneeId?: string | null;
  /** ISO date string (YYYY-MM-DD). Optional. */
  dueDate?: string | null;
}

/**
 * Input for updating an existing task's editable fields.
 * Only the listed fields are updatable. company_id, board_id, column_id,
 * created_by, and position are excluded.
 *
 * For moves (column change), use MoveTaskInput.
 */
export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "description" | "priority" | "assigneeId" | "dueDate">
>;

/**
 * Input for moving a task to a different column.
 * Position in the target column is always computed server-side as MAX(position)+1.
 */
export interface MoveTaskInput {
  taskId: string;
  toColumnId: string;
  /** Required so the hooks can invalidate the correct board cache key. */
  boardId: string;
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

/**
 * Error codes for the tasks feature.
 *
 * Maps to the handoff error taxonomy from database-to-backend-tasks.md:
 *   NOT_FOUND        — FK violation (23503) or no rows returned (PGRST116)
 *   FORBIDDEN        — RLS block (42501)
 *   VALIDATION_ERROR — CHECK violation (23514) or service-layer input validation
 *   CONFLICT         — (reserved; concurrent write issues)
 *   UNAUTHENTICATED  — missing session at hook layer
 *   UNKNOWN_ERROR    — all other failures
 */
export type TasksErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "UNAUTHENTICATED"
  | "UNKNOWN_ERROR";

export class TasksError extends Error {
  constructor(
    public readonly code: TasksErrorCode,
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "TasksError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TasksError);
    }
  }
}
