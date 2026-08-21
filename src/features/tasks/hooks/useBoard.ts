"use client";

/**
 * useBoard — TanStack Query hook for loading a board with all columns and tasks.
 *
 * Data source: TasksRepository.getBoardWithDetails() via SupabaseTasksRepository.
 * Uses the browser Supabase client (anon key + RLS). No Server Action.
 *
 * Return shape:
 *   { board: Board | null, isLoading: boolean, error: TasksError | null }
 *
 * Returns null board in two cases (both render as "no access" in UI):
 *   a) The board does not exist.
 *   b) The calling user has no RLS access to this board (not a team member).
 *
 * staleTime: 30 seconds. Board data changes frequently (task moves, creates).
 * Mutations always invalidate this key on settle to force a refetch.
 *
 * The hook does not redirect on access-denied — that is the frontend's concern.
 */

import { useQuery } from "@tanstack/react-query";
import { tasksQueryKeys } from "./tasksQueryKeys";
import { SupabaseTasksRepository } from "../repositories/SupabaseTasksRepository";
import { TasksService } from "../services/tasksService";
import type { Board } from "../types";

// Module-level singletons — safe for client-side use (stateless, no server secrets).
const tasksRepository = new SupabaseTasksRepository();
const tasksService = new TasksService(tasksRepository);

export function useBoard(boardId: string | undefined): {
  board: Board | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery<Board | null, Error>({
    queryKey: tasksQueryKeys.list(boardId ?? ""),
    queryFn: () => tasksService.getBoard(boardId!),
    enabled: !!boardId,
    staleTime: 30 * 1000, // 30 seconds — board changes frequently
    retry: false,         // Don't retry auth/access errors — fail fast
  });

  return {
    board: data ?? null,
    isLoading,
    error: error ?? null,
  };
}

// Export the singleton service and repository for use by mutation hooks.
// This ensures all hooks share the same instance — avoids duplicate instantiation.
export { tasksService, tasksRepository };
