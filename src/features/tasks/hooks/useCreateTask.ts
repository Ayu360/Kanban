"use client";

/**
 * useCreateTask — TanStack Query mutation hook for creating a new task.
 *
 * Calls TasksService.create() which:
 *   1. Validates title/description/priority.
 *   2. Sources userId and companyId from the repository via getUser() (server-
 *      validated — not from client input or getSession()).
 *   3. Validates assigneeId against employee_directory (if provided).
 *   4. Computes position = MAX(position in column) + 1.
 *   5. Calls SupabaseTasksRepository.create().
 *
 * Session sourcing: handled inside the service via repo.getCurrentUserContext().
 * This hook does NOT import or call the Supabase client directly.
 *
 * Cache invalidation:
 *   onSettled: invalidate list(boardId) — fires on both success and error,
 *   ensuring the cache is never left stale after a network failure.
 *
 * Error contract:
 *   mutationFn throws TasksError on failure.
 *   Callers should handle error from useMutation's error state.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tasksQueryKeys } from "./tasksQueryKeys";
import { tasksService } from "./useBoard";
import { TasksError } from "../types";
import type { Task, CreateTaskInput } from "../types";

interface CreateTaskVariables extends CreateTaskInput {
  boardId: string;
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation<Task, TasksError, CreateTaskVariables>({
    mutationFn: (variables) => tasksService.create(variables),
    onSettled: (_, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: tasksQueryKeys.list(variables.boardId),
      });
    },
  });
}
