/**
 * TasksRepository — the repository interface for the tasks feature.
 *
 * This is the swap seam (ADR-0004). The service layer and hooks depend on this
 * interface, not on SupabaseTasksRepository. Swapping the backend means
 * providing a new concrete implementation; nothing above this layer changes.
 *
 * Design rules:
 *   - All methods return domain DTOs (Task, Board, Column), never Supabase types.
 *   - All methods throw TasksError on failure, never PostgrestError.
 *   - Methods are async. No synchronous reads.
 *   - No Supabase imports in this file.
 *   - The repository does NOT compute positions — the service layer does.
 *     The create() and move() methods accept pre-computed position values.
 *   - company_id and created_by are NEVER sourced from client input.
 *     The service layer derives them from the authenticated session and passes
 *     them as explicit parameters to create(). The repository writes them as-is.
 */

import type { Board, Task, CreateTaskInput, UpdateTaskInput } from "../types";

export interface TasksRepository {
  /**
   * Loads the board with all its columns and tasks in a single round-trip.
   * Uses PostgREST embedded selects: boards → columns → tasks.
   * Returns null if the board does not exist or the caller has no RLS access.
   *
   * Results are ordered by column.position ASC, then task.position ASC.
   *
   * Throws TasksError on unexpected query failure (network, timeout, etc.).
   */
  getBoardWithDetails(boardId: string): Promise<Board | null>;

  /**
   * Inserts a new task row.
   *
   * The caller (TasksService) is responsible for:
   *   - Deriving companyId from the authenticated session JWT.
   *   - Deriving createdBy from the authenticated user's profile ID.
   *   - Computing position as MAX(position)+1 in the target column.
   *
   * Throws TasksError normalized from PostgrestError:
   *   - NOT_FOUND       → column_id or board_id FK violation (23503)
   *   - VALIDATION_ERROR → CHECK violation (23514) — e.g. empty title, bad priority,
   *                        company_id/board_id mismatch from consistency trigger
   *   - FORBIDDEN       → RLS block (42501) — caller lacks INSERT access
   */
  create(
    input: CreateTaskInput & {
      companyId: string;
      createdBy: string;
      position: number;
    }
  ): Promise<Task>;

  /**
   * Updates an existing task's editable fields.
   * Does NOT touch column_id, board_id, company_id, created_by, or position.
   *
   * Throws TasksError:
   *   - NOT_FOUND       → no row returned (PGRST116) — task deleted or RLS-filtered
   *   - FORBIDDEN       → RLS block (42501)
   *   - VALIDATION_ERROR → CHECK violation (23514)
   */
  update(id: string, input: UpdateTaskInput): Promise<Task>;

  /**
   * Moves a task to a different column by updating column_id and position atomically.
   * The consistency trigger (check_task_company_id_match) validates that the
   * target column belongs to the same board.
   *
   * Throws TasksError:
   *   - NOT_FOUND       → task not found (PGRST116) or invalid column FK (23503)
   *   - VALIDATION_ERROR → cross-board move caught by consistency trigger (23514)
   *   - FORBIDDEN       → RLS block (42501)
   */
  move(id: string, toColumnId: string, toPosition: number): Promise<Task>;

  /**
   * Hard-deletes a task row. Per PRD FR-05 / RLS: any authenticated team member
   * with board access can delete any task on that board.
   *
   * Throws TasksError:
   *   - NOT_FOUND → row did not exist or was RLS-filtered
   *   - FORBIDDEN → RLS block (42501)
   */
  delete(id: string): Promise<void>;

  /**
   * Returns the current maximum position value for tasks in the given column.
   * Returns null if the column is empty (no tasks).
   *
   * Used by TasksService to compute the next position before insert or move.
   * Passing excludeTaskId excludes that task's own row (used during move to
   * correctly compute the target column's max without the task being moved).
   */
  getMaxPositionInColumn(
    columnId: string,
    excludeTaskId?: string
  ): Promise<number | null>;

  /**
   * Returns a single task by its ID.
   * Returns null if not found or RLS-filtered.
   *
   * Used by TasksService.move() to fetch the current task's column/board context
   * before computing the target position.
   */
  getById(id: string): Promise<Task | null>;

  /**
   * Returns true if the given profile ID is visible in the employee_directory
   * view for the calling user's session.
   *
   * Company-scoping is enforced by RLS on the view — profiles from other
   * companies (or deactivated / non-existent profiles) return false.
   *
   * Throws TasksError on unexpected query failure.
   */
  isAssigneeInDirectory(assigneeId: string): Promise<boolean>;

  /**
   * Returns the board_id for the given column, or null if the column does not
   * exist or is RLS-filtered.
   *
   * Throws TasksError on network failure or unexpected DB error.
   * Returns null for genuine "column not found" (not an error).
   *
   * Used by TasksService.move() to validate that the target column belongs to
   * the same board as the task being moved.
   */
  getColumnBoardId(columnId: string): Promise<string | null>;

  /**
   * Returns the current authenticated user's context (userId + companyId),
   * or null if not signed in or if the session is missing company information.
   *
   * Uses auth.getUser() (server-validated) rather than getSession().
   * company_id is read from app_metadata, which is not client-mutable.
   */
  getCurrentUserContext(): Promise<{ userId: string; companyId: string } | null>;
}
