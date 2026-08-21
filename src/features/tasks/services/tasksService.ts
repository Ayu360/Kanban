/**
 * TasksService — business logic layer for the tasks feature.
 *
 * Orchestrates repository calls and enforces domain rules:
 *   1. Input validation (title length, description length, priority values).
 *   2. Position computation (MAX+1 client-side, per Phase 1 locked decision).
 *   3. Assignee validation against employee_directory (cross-company guard — handoff §5).
 *   4. Move validation (same-board check before round-tripping the DB).
 *
 * Client-side service: This service runs in the browser (ADR-0015 — task CRUD
 * is client-side Supabase writes, not Server Actions). It does NOT use
 * "server-only" and must never import server-only modules.
 *
 * Authorization is enforced at the DB layer via RLS. The service does not
 * duplicate role checks — it relies on the repository to surface FORBIDDEN
 * errors when RLS blocks an operation.
 *
 * Session handling:
 *   - The service calls this.repo.getCurrentUserContext() to obtain userId and
 *     companyId from the authenticated session (server-validated via getUser()).
 *   - company_id and created_by are NEVER sourced from client input.
 *   - No Supabase client import lives here — all I/O goes through the repository.
 */

import type { TasksRepository } from "../repositories/TasksRepository";
import type {
  Board,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  MoveTaskInput,
} from "../types";
import { TasksError } from "../types";

// ---------------------------------------------------------------------------
// Validation helpers (pure functions, no I/O)
// ---------------------------------------------------------------------------

/**
 * Validates task title. Returns a user-facing error message or null on success.
 * Mirrors the DB CHECK: char_length(trim(title)) BETWEEN 1 AND 500.
 */
function validateTitle(title: string | undefined | null): string | null {
  if (!title || title.trim().length === 0) return "Task title is required.";
  if (title.trim().length > 500)
    return "Task title cannot exceed 500 characters.";
  return null;
}

/**
 * Validates task description. Returns a user-facing error message or null.
 * Mirrors the DB CHECK: description IS NULL OR char_length(description) <= 5000.
 */
function validateDescription(
  description: string | undefined | null
): string | null {
  if (description !== undefined && description !== null) {
    if (description.length > 5000)
      return "Task description cannot exceed 5000 characters.";
  }
  return null;
}

/**
 * Validates priority value. Returns a user-facing error message or null.
 */
function validatePriority(priority: string | undefined | null): string | null {
  if (
    priority !== undefined &&
    priority !== null &&
    !["low", "medium", "high"].includes(priority)
  ) {
    return "Priority must be 'low', 'medium', or 'high'.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// TasksService
// ---------------------------------------------------------------------------

export class TasksService {
  constructor(private readonly repo: TasksRepository) {}

  // -------------------------------------------------------------------------
  // getBoard
  // -------------------------------------------------------------------------
  /**
   * Returns the board with all columns and tasks.
   * Returns null if the board does not exist or the caller has no access.
   */
  async getBoard(boardId: string): Promise<Board | null> {
    return this.repo.getBoardWithDetails(boardId);
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  /**
   * Creates a new task.
   *
   * Steps:
   *   1. Validate title, description, priority.
   *   2. Obtain userId and companyId from the repository (server-validated
   *      getUser() call — never from client form input).
   *   3. If assigneeId is provided, validate it against employee_directory
   *      via the repository (guards cross-company assignee writes — handoff §5).
   *   4. Compute position = MAX(position in target column) + 1.
   *   5. Insert via repository.
   */
  async create(input: CreateTaskInput): Promise<Task> {
    // Step 1: Validate inputs
    const titleError = validateTitle(input.title);
    if (titleError) throw new TasksError("VALIDATION_ERROR", titleError);

    const descError = validateDescription(input.description);
    if (descError) throw new TasksError("VALIDATION_ERROR", descError);

    const priorityError = validatePriority(input.priority);
    if (priorityError) throw new TasksError("VALIDATION_ERROR", priorityError);

    if (!input.columnId) {
      throw new TasksError("VALIDATION_ERROR", "Column is required.");
    }

    if (!input.boardId) {
      throw new TasksError("VALIDATION_ERROR", "Board is required.");
    }

    // Step 2: Obtain user context via repository (server-validated getUser())
    const userContext = await this.repo.getCurrentUserContext();
    if (!userContext) {
      throw new TasksError(
        "UNAUTHENTICATED",
        "You must be signed in to create a task."
      );
    }
    const { userId: createdBy, companyId } = userContext;

    // Step 3: Validate assigneeId against employee_directory if provided
    if (input.assigneeId) {
      await this.validateAssigneeInDirectory(input.assigneeId);
    }

    // Step 4: Compute position (MAX+1 in target column)
    const maxPosition = await this.repo.getMaxPositionInColumn(input.columnId);
    const position = maxPosition !== null ? maxPosition + 1 : 1;

    // Step 5: Insert
    return this.repo.create({
      ...input,
      companyId,
      createdBy,
      position,
    });
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  /**
   * Updates an existing task's editable fields.
   * Validates any provided assigneeId against employee_directory.
   */
  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    if (input.title !== undefined) {
      const titleError = validateTitle(input.title);
      if (titleError) throw new TasksError("VALIDATION_ERROR", titleError);
    }

    if (input.description !== undefined) {
      const descError = validateDescription(input.description);
      if (descError) throw new TasksError("VALIDATION_ERROR", descError);
    }

    if (input.priority !== undefined) {
      const priorityError = validatePriority(input.priority);
      if (priorityError) throw new TasksError("VALIDATION_ERROR", priorityError);
    }

    // Validate assigneeId against employee_directory if provided and non-null
    if (input.assigneeId !== undefined && input.assigneeId !== null) {
      await this.validateAssigneeInDirectory(input.assigneeId);
    }

    return this.repo.update(id, input);
  }

  // -------------------------------------------------------------------------
  // move
  // -------------------------------------------------------------------------
  /**
   * Moves a task to a different column.
   *
   * Steps:
   *   1. Load the current task to get its columnId and boardId.
   *   2. If same column, no-op (return existing task).
   *   3. Verify the target column belongs to the same board (early cross-board guard).
   *      The DB consistency trigger also enforces this, but early validation
   *      produces a better error message.
   *   4. Compute MAX position in target column (excluding the task being moved).
   *   5. Update via repository.
   */
  async move(input: MoveTaskInput): Promise<Task> {
    const { taskId, toColumnId } = input;

    // Step 1: Load current task
    const task = await this.repo.getById(taskId);
    if (!task) {
      throw new TasksError("NOT_FOUND", "Task not found or you do not have access.");
    }

    // Step 2: No-op if already in the target column
    if (task.columnId === toColumnId) {
      return task;
    }

    // Step 3: Verify target column belongs to the same board.
    // Delegates to the repository which queries the columns table directly.
    // The consistency trigger will also block this at the DB layer, but surfacing
    // the error here gives a clearer message.
    const targetColumnBoardId = await this.repo.getColumnBoardId(toColumnId);
    if (!targetColumnBoardId) {
      throw new TasksError(
        "NOT_FOUND",
        "Target column not found or you do not have access."
      );
    }

    if (targetColumnBoardId !== task.boardId) {
      throw new TasksError(
        "VALIDATION_ERROR",
        "Cannot move a task to a column on a different board."
      );
    }

    // Step 4: Compute MAX position in target column (exclude the task being moved
    // in case the same column comes up in a race — belt-and-suspenders)
    const maxPosition = await this.repo.getMaxPositionInColumn(
      toColumnId,
      taskId
    );
    const toPosition = maxPosition !== null ? maxPosition + 1 : 1;

    // Step 5: Persist the move
    return this.repo.move(taskId, toColumnId, toPosition);
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  /**
   * Hard-deletes a task. Straight pass-through to the repository.
   * Authorization is enforced by RLS (any team member with board access can delete).
   */
  async delete(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Validates that the given profile ID is visible in the employee_directory view.
   * Delegates to the repository which queries the view via the browser client.
   * RLS on the view scopes results to the caller's company automatically.
   *
   * This guard is MANDATORY per handoff Known Limitation #5:
   *   "A team member making a direct PostgREST call bypassing the picker can
   *   currently set assignee_id to any valid profiles.id from any company."
   * This service-layer check is the sole enforcement until a DB trigger is added.
   */
  private async validateAssigneeInDirectory(assigneeId: string): Promise<void> {
    const inDirectory = await this.repo.isAssigneeInDirectory(assigneeId);

    if (!inDirectory) {
      throw new TasksError(
        "VALIDATION_ERROR",
        "Selected assignee is not an active employee in your company."
      );
    }
  }
}
