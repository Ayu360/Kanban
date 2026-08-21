"use client";

/**
 * useUpdateTask — TanStack Query mutation hook for editing a task's fields.
 *
 * Updates: title, description, priority, assigneeId, dueDate.
 * Does NOT update: columnId, boardId, companyId, createdBy, position.
 * For moves (column change), use useMoveTask.
 *
 * Calls TasksService.update() which validates the update payload and
 * checks assigneeId against employee_directory if provided.
 *
 * Cache invalidation:
 *   onSettled: invalidate list(boardId) — fires on both success and error so
 *   the cache is never left stale after a mid-flight network failure.
 *   Non-optimistic: edits are low-frequency and the delay is acceptable.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksQueryKeys } from "./tasksQueryKeys";
import { tasksService } from "./useBoard";
import { TasksError } from "../types";
import type { Task, UpdateTaskInput } from "../types";

interface UpdateTaskVariables extends UpdateTaskInput {
  id: string;
  boardId: string;
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation<Task, TasksError, UpdateTaskVariables>({
    mutationFn: (variables) => {
      // boardId is used in onSuccess for cache invalidation; excluded from service input.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, boardId, ...input } = variables;
      return tasksService.update(id, input);
    },
    onSettled: (_, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: tasksQueryKeys.list(variables.boardId),
      });
    },
  });
}
