"use client";

/**
 * useMoveTask — TanStack Query mutation hook for moving a task to a different column.
 *
 * Optimistic update contract (Reviewer R5 compliant):
 *   1. onMutate:
 *      a. Cancel any in-flight board queries to prevent a stale refetch from
 *         overwriting our optimistic update mid-flight.
 *      b. Snapshot the current board data (the rollback value).
 *      c. Apply a TARGETED patch: physically extract the task from its source
 *         column's tasks array and append it to the target column's tasks array.
 *         columnId and position are updated on the moved task. All other columns
 *         and tasks are returned unchanged (immutable copies at every level).
 *         Reviewer R5: "rollback is a targeted patch, not full snapshot restore."
 *      d. Return { previousBoard } as the mutation context for rollback.
 *   2. onError:
 *      Roll back the cache to previousBoard (the snapshot from step 1b).
 *   3. onSettled:
 *      Invalidate list(boardId) so the server position ordering is refetched.
 *      This resolves any concurrent race conditions (duplicate positions, etc.)
 *      and ensures the UI reflects the authoritative server state.
 *
 * Note on optimistic position:
 *   The optimistic position is appended at the end of the target column's
 *   current task count + 1. The authoritative order is resolved on onSettled.
 *
 * Optimistic pattern: snapshot → physical extract-and-append → onError rollback → onSettled invalidate. Per PRD 04 optimistic move contract.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksQueryKeys } from "./tasksQueryKeys";
import { tasksService } from "./useBoard";
import { TasksError } from "../types";
import type { Task, Board, MoveTaskInput } from "../types";

/**
 * Applies the optimistic move to the cached board.
 *
 * Physically extracts the task from its source column's tasks array and appends
 * it to the target column's tasks array. Updates columnId and position on the
 * moved task object. All operations are immutable — returns a new board with
 * new column and task objects; the input board is never mutated.
 *
 * Same-column no-op: if source and target column are identical, returns the
 * board unchanged (the service will short-circuit anyway, but the cache patch
 * must also be a no-op to avoid a spurious re-render).
 *
 * Note on optimistic position:
 *   toPosition is set to the length of the target column's tasks array + 1 at
 *   the time of the optimistic patch — a reasonable approximation that appends
 *   the task visually. The authoritative position is resolved by onSettled refetch.
 */
function applyOptimisticMove(
  board: Board | undefined,
  taskId: string,
  toColumnId: string,
  toPosition: number
): Board | undefined {
  if (!board) return board;

  // Find the source column (the one that currently contains this task).
  const sourceColumn = board.columns.find((col) =>
    col.tasks.some((t: Task) => t.id === taskId)
  );

  // If the task is not found in any column, return board unchanged.
  if (!sourceColumn) return board;

  // Same-column move: no-op at the cache level.
  if (sourceColumn.id === toColumnId) return board;

  // Extract the task from the source column.
  const taskToMove = sourceColumn.tasks.find((t: Task) => t.id === taskId);
  if (!taskToMove) return board;

  // Produce the updated task with new column context.
  const updatedTask: Task = { ...taskToMove, columnId: toColumnId, position: toPosition };

  return {
    ...board,
    columns: board.columns.map((col) => {
      if (col.id === sourceColumn.id) {
        // Remove the task from source column.
        return {
          ...col,
          tasks: col.tasks.filter((t: Task) => t.id !== taskId),
        };
      }
      if (col.id === toColumnId) {
        // Append the task to target column.
        return {
          ...col,
          tasks: [...col.tasks, updatedTask],
        };
      }
      return col;
    }),
  };
}

export function useMoveTask() {
  const queryClient = useQueryClient();

  return useMutation<Task, TasksError, MoveTaskInput>({
    mutationFn: (variables) => tasksService.move(variables),

    // -----------------------------------------------------------------------
    // onMutate: snapshot → targeted optimistic patch
    // -----------------------------------------------------------------------
    onMutate: async (variables) => {
      const { taskId, toColumnId, boardId } = variables;
      const queryKey = tasksQueryKeys.list(boardId);

      // Cancel any in-flight refetches for this board so they don't clobber
      // our optimistic update.
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the current cache for rollback.
      const previousBoard = queryClient.getQueryData<Board>(queryKey);

      // Compute the optimistic position: append at the end of the target column.
      // Find target column's current task count from the snapshot.
      const targetColumn = previousBoard?.columns.find(
        (col) => col.id === toColumnId
      );
      const toPosition = (targetColumn?.tasks.length ?? 0) + 1;

      // Apply the targeted optimistic patch: physically move the task between
      // column arrays and update columnId + position on the task object.
      // Reviewer R5: targeted patch, not full board restore.
      queryClient.setQueryData<Board>(queryKey, (old) =>
        applyOptimisticMove(old, taskId, toColumnId, toPosition)
      );

      return { previousBoard };
    },

    // -----------------------------------------------------------------------
    // onError: rollback to snapshot
    // -----------------------------------------------------------------------
    onError: (_err, variables, context) => {
      const rollbackContext = context as
        | { previousBoard: Board | undefined }
        | undefined;

      if (rollbackContext?.previousBoard !== undefined) {
        queryClient.setQueryData(
          tasksQueryKeys.list(variables.boardId),
          rollbackContext.previousBoard
        );
      }
    },

    // -----------------------------------------------------------------------
    // onSettled: invalidate to resolve any server-side ordering changes
    // -----------------------------------------------------------------------
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: tasksQueryKeys.list(variables.boardId),
      });
    },
  });
}
