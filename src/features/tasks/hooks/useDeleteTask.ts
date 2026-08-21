"use client";

/**
 * useDeleteTask — TanStack Query mutation hook for hard-deleting a task.
 *
 * Per PRD FR-05 and RLS: any authenticated team member with board access can
 * delete any task on that board. No creator-only restriction in MVP.
 *
 * Non-optimistic: a confirmation dialog is shown before calling this mutation,
 * so the latency is acceptable. The card disappears on onSettled refetch.
 *
 * Cache invalidation:
 *   onSettled: invalidate list(boardId) — fires on both success and error so
 *   the cache is never left stale after a mid-flight network failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksQueryKeys } from "./tasksQueryKeys";
import { tasksService } from "./useBoard";
import { TasksError } from "../types";

interface DeleteTaskVariables {
  taskId: string;
  boardId: string;
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation<void, TasksError, DeleteTaskVariables>({
    mutationFn: ({ taskId }) => tasksService.delete(taskId),
    onSettled: (_, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: tasksQueryKeys.list(variables.boardId),
      });
    },
  });
}
