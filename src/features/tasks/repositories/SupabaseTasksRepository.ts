/**
 * SupabaseTasksRepository — Supabase implementation of TasksRepository.
 *
 * This is the ONLY file in the tasks feature allowed to call Supabase clients
 * directly. All Supabase-specific types (PostgrestError) are caught here and
 * re-thrown as TasksError so the service layer and hooks never see Supabase
 * internals (ADR-0004).
 *
 * Client: getSupabaseBrowserClient() (anon key + RLS).
 * Task CRUD is client-side (ADR-0015) — no service-role client is used here.
 * RLS policies on the tasks table enforce row-level access.
 *
 * Error normalization (handoff error taxonomy):
 *   23503 (foreign_key_violation) → NOT_FOUND
 *   23514 (check_violation)       → VALIDATION_ERROR
 *   42501 (insufficient_priv)     → FORBIDDEN
 *   PGRST116 (no rows .single())  → NOT_FOUND
 *   Other                         → UNKNOWN_ERROR
 */

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { TasksRepository } from "./TasksRepository";
import type { Board, Column, Task, CreateTaskInput, UpdateTaskInput } from "../types";
import { TasksError } from "../types";

// ---------------------------------------------------------------------------
// PostgreSQL / PostgREST error code constants
// ---------------------------------------------------------------------------

const PG_FK_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const POSTGREST_NO_ROWS = "PGRST116";

// ---------------------------------------------------------------------------
// Private row types — shapes returned by PostgREST. Isolated here so
// Supabase-specific snake_case column names never surface above this file.
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string;
  column_id: string;
  board_id: string;
  company_id: string;
  title: string;
  description: string | null;
  priority: string;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ColumnRow = {
  id: string;
  board_id: string;
  title: string;
  position: number;
  tasks: TaskRow[];
};

type BoardRow = {
  id: string;
  team_id: string;
  company_id: string;
  name: string;
  columns: ColumnRow[];
};

// ---------------------------------------------------------------------------
// Row-to-DTO mappers
// ---------------------------------------------------------------------------

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority as Task["priority"],
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    position: row.position,
    columnId: row.column_id,
    boardId: row.board_id,
    companyId: row.company_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToColumn(row: ColumnRow): Column {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    position: row.position,
    tasks: (row.tasks ?? []).map((t) => rowToTask(t as unknown as TaskRow)),
  };
}

function rowToBoard(row: BoardRow): Board {
  return {
    id: row.id,
    teamId: row.team_id,
    companyId: row.company_id,
    title: row.name,
    columns: (row.columns ?? []).map((c) =>
      rowToColumn(c as unknown as ColumnRow)
    ),
  };
}

// ---------------------------------------------------------------------------
// Error mapper
// ---------------------------------------------------------------------------

function normalizePostgrestError(
  error: { code?: string; message?: string; details?: string | null },
  context: string
): TasksError {
  const code = error.code ?? "";
  const message = error.message ?? "";

  switch (code) {
    case PG_FK_VIOLATION:
      return new TasksError(
        "NOT_FOUND",
        `Referenced resource not found in ${context}. Check that column_id, board_id, or assignee_id exist.`,
        error
      );

    case PG_CHECK_VIOLATION:
      return new TasksError(
        "VALIDATION_ERROR",
        `Validation failed in ${context}: ${message}`,
        error
      );

    case PG_INSUFFICIENT_PRIVILEGE:
      return new TasksError(
        "FORBIDDEN",
        "You do not have permission to perform this action.",
        error
      );

    case POSTGREST_NO_ROWS:
      return new TasksError(
        "NOT_FOUND",
        `${context} not found or you do not have access.`,
        error
      );

    default: {
      const lower = message.toLowerCase();
      if (
        lower.includes("insufficient_privilege") ||
        lower.includes("permission denied")
      ) {
        return new TasksError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          error
        );
      }
      return new TasksError(
        "UNKNOWN_ERROR",
        `An unexpected error occurred in ${context}. Please try again.`,
        error
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SupabaseTasksRepository
// ---------------------------------------------------------------------------

export class SupabaseTasksRepository implements TasksRepository {
  // -------------------------------------------------------------------------
  // getBoardWithDetails
  // -------------------------------------------------------------------------
  /**
   * Loads the board with all columns and tasks in a single PostgREST query.
   *
   * PostgREST embedded selects (columns → tasks) let us load the full board
   * in one HTTP round-trip. RLS fires on all three tables automatically;
   * only rows accessible to the calling session are returned.
   *
   * Column ordering: position ASC (seeded at team creation).
   * Task ordering within each column: position ASC.
   *
   * Returns null on PGRST116 (empty result) — this means either:
   *   a) The board does not exist.
   *   b) The calling user has no RLS access to this board.
   * Both map to the same UX ("board not found or no access").
   */
  async getBoardWithDetails(boardId: string): Promise<Board | null> {
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from("boards")
      .select(
        "id, team_id, company_id, name, columns(id, board_id, title, position, tasks(id, column_id, board_id, company_id, title, description, priority, assignee_id, due_date, position, created_by, created_at, updated_at))"
      )
      .eq("id", boardId)
      .order("position", { referencedTable: "columns", ascending: true })
      .order("position", { referencedTable: "columns.tasks", ascending: true })
      .single();

    if (error) {
      if (error.code === POSTGREST_NO_ROWS) {
        return null;
      }
      throw normalizePostgrestError(error, "getBoardWithDetails");
    }

    if (!data) return null;

    return rowToBoard(data as unknown as BoardRow);
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  /**
   * Inserts a new task. companyId, createdBy, and position are passed in
   * by the service layer (never from client input).
   */
  async create(
    input: CreateTaskInput & {
      companyId: string;
      createdBy: string;
      position: number;
    }
  ): Promise<Task> {
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        column_id: input.columnId,
        board_id: input.boardId,
        company_id: input.companyId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority ?? "medium",
        assignee_id: input.assigneeId ?? null,
        due_date: input.dueDate ?? null,
        position: input.position,
        created_by: input.createdBy,
      })
      .select(
        "id, column_id, board_id, company_id, title, description, priority, assignee_id, due_date, position, created_by, created_at, updated_at"
      )
      .single();

    if (error) {
      throw normalizePostgrestError(error, "create");
    }

    if (!data) {
      throw new TasksError(
        "UNKNOWN_ERROR",
        "Task creation returned no data. Please try again."
      );
    }

    return rowToTask(data as unknown as TaskRow);
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  /**
   * Updates an existing task's editable fields.
   * Never touches column_id, board_id, company_id, created_by, or position.
   */
  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const supabase = getSupabaseBrowserClient();

    // Build update payload — only include fields that were explicitly provided.
    // This prevents overwriting fields not included in the update input.
    const updatePayload: Record<string, unknown> = {};
    if (input.title !== undefined) updatePayload.title = input.title.trim();
    if (input.description !== undefined)
      updatePayload.description = input.description?.trim() || null;
    if (input.priority !== undefined) updatePayload.priority = input.priority;
    if (input.assigneeId !== undefined)
      updatePayload.assignee_id = input.assigneeId;
    if (input.dueDate !== undefined) updatePayload.due_date = input.dueDate;

    const { data, error } = await supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", id)
      .select(
        "id, column_id, board_id, company_id, title, description, priority, assignee_id, due_date, position, created_by, created_at, updated_at"
      )
      .single();

    if (error) {
      throw normalizePostgrestError(error, "update");
    }

    if (!data) {
      throw new TasksError("NOT_FOUND", "Task not found or you do not have access.");
    }

    return rowToTask(data as unknown as TaskRow);
  }

  // -------------------------------------------------------------------------
  // move
  // -------------------------------------------------------------------------
  /**
   * Moves a task to a different column with a pre-computed target position.
   * The consistency trigger (check_task_company_id_match) validates cross-board
   * moves at the DB layer — it fires on every UPDATE that changes column_id.
   */
  async move(id: string, toColumnId: string, toPosition: number): Promise<Task> {
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from("tasks")
      .update({
        column_id: toColumnId,
        position: toPosition,
      })
      .eq("id", id)
      .select(
        "id, column_id, board_id, company_id, title, description, priority, assignee_id, due_date, position, created_by, created_at, updated_at"
      )
      .single();

    if (error) {
      throw normalizePostgrestError(error, "move");
    }

    if (!data) {
      throw new TasksError("NOT_FOUND", "Task not found or you do not have access.");
    }

    return rowToTask(data as unknown as TaskRow);
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  /**
   * Hard-deletes a task. Per RLS: any team member with board access can delete
   * any task on a board they belong to (PRD FR-05).
   *
   * We check affected count to surface NOT_FOUND when the row was already
   * deleted or was RLS-filtered before reaching the DELETE.
   */
  async delete(id: string): Promise<void> {
    const supabase = getSupabaseBrowserClient();

    const { error, count } = await supabase
      .from("tasks")
      .delete({ count: "exact" })
      .eq("id", id);

    if (error) {
      throw normalizePostgrestError(error, "delete");
    }

    if (count === 0) {
      throw new TasksError(
        "NOT_FOUND",
        "Task not found or you do not have permission to delete it."
      );
    }
  }

  // -------------------------------------------------------------------------
  // getMaxPositionInColumn
  // -------------------------------------------------------------------------
  /**
   * Returns the maximum position value for tasks in the given column,
   * optionally excluding a specific task (used during move to exclude
   * the task being moved from the target column's max calculation).
   *
   * Returns null if the column has no tasks (excluding the excluded task).
   */
  async getMaxPositionInColumn(
    columnId: string,
    excludeTaskId?: string
  ): Promise<number | null> {
    const supabase = getSupabaseBrowserClient();

    let query = supabase
      .from("tasks")
      .select("position")
      .eq("column_id", columnId)
      .order("position", { ascending: false })
      .limit(1);

    if (excludeTaskId) {
      query = query.neq("id", excludeTaskId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw normalizePostgrestError(error, "getMaxPositionInColumn");
    }

    return data?.position ?? null;
  }

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------
  /**
   * Returns a single task by ID, or null if not found / RLS-filtered.
   * Used by TasksService.move() to fetch the current task context.
   */
  async getById(id: string): Promise<Task | null> {
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, column_id, board_id, company_id, title, description, priority, assignee_id, due_date, position, created_by, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw normalizePostgrestError(error, "getById");
    }

    if (!data) return null;

    return rowToTask(data as unknown as TaskRow);
  }

  // -------------------------------------------------------------------------
  // isAssigneeInDirectory
  // -------------------------------------------------------------------------
  /**
   * Returns true if the given profile ID is visible in the employee_directory
   * view for the calling user's session.
   *
   * The view is company-scoped by RLS — a profile from another company (or a
   * deactivated / non-existent profile) returns no rows, so this returns false.
   *
   * Used by TasksService to guard assigneeId writes (cross-company prevention).
   * Throws TasksError on unexpected query failure (network, RLS permission error).
   */
  async isAssigneeInDirectory(assigneeId: string): Promise<boolean> {
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from("employee_directory")
      .select("id")
      .eq("id", assigneeId)
      .maybeSingle();

    if (error) {
      throw normalizePostgrestError(error, "isAssigneeInDirectory");
    }

    return data !== null;
  }

  // -------------------------------------------------------------------------
  // getColumnBoardId
  // -------------------------------------------------------------------------
  /**
   * Returns the board_id for the given column, or null if the column does not
   * exist or is RLS-filtered.
   *
   * Error vs not-found separation (Fix M1):
   *   - error   → throw UNKNOWN_ERROR (network failure, permission denied, etc.)
   *   - !data   → return null (genuine "column not found")
   *   - data    → return data.board_id
   *
   * Used by TasksService.move() to validate cross-board moves before the DB
   * round-trip. The consistency trigger also enforces this at the DB layer,
   * but early validation here produces a clearer error message.
   */
  async getColumnBoardId(columnId: string): Promise<string | null> {
    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from("columns")
      .select("board_id")
      .eq("id", columnId)
      .maybeSingle();

    if (error) {
      throw normalizePostgrestError(error, "getColumnBoardId");
    }

    if (!data) return null;

    return (data as { board_id: string }).board_id;
  }

  // -------------------------------------------------------------------------
  // getCurrentUserContext
  // -------------------------------------------------------------------------
  /**
   * Returns the current user's auth context ({ userId, companyId }) using
   * getUser() (server-validated round-trip), or null if no active session.
   *
   * Uses getUser() rather than getSession() to validate the token server-side.
   * getSession() only reads from local storage and can return stale/expired tokens.
   *
   * company_id is sourced from public.profiles (the source of truth), NOT from
   * auth.users.app_metadata. Rationale: the JWT hook adds company_id to the
   * JWT claims at token-issuance, but does NOT sync back into
   * auth.users.raw_app_meta_data — so data.user.app_metadata.company_id is
   * always undefined here. Every other module in this codebase (see
   * SupabaseAuthRepository, useCurrentUser) reads company_id from profiles
   * for the same reason. RLS policy profiles_select_own permits this read.
   */
  async getCurrentUserContext(): Promise<{ userId: string; companyId: string } | null> {
    const supabase = getSupabaseBrowserClient();

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile) {
      return null;
    }

    return { userId: authData.user.id, companyId: (profile as { company_id: string }).company_id };
  }
}
