"use client";

/**
 * tasksQueryKeys — centralized TanStack Query key factory for the tasks feature.
 *
 * ADR-0013: query keys follow [feature, entity, scope, params].
 * All mutations that write to tasks must invalidate the relevant key here —
 * never hardcode query key strings in mutation hooks.
 *
 * Key hierarchy:
 *   all                → ['tasks']
 *   lists()            → ['tasks', 'list']
 *   list(boardId)      → ['tasks', 'list', { boardId }]
 *   details()          → ['tasks', 'detail']
 *   detail(taskId)     → ['tasks', 'detail', { id }]
 *
 * Invalidation convention:
 *   After create, update, move, or delete: invalidate list(boardId).
 *   This refetches the full board (columns + tasks) from the server,
 *   ensuring position ordering and any concurrent changes are resolved.
 */

export const tasksQueryKeys = {
  /** Root key — invalidates everything in the tasks feature. */
  all: ["tasks"] as const,

  /** Invalidates all board/list queries. */
  lists: () => [...tasksQueryKeys.all, "list"] as const,

  /**
   * Key for a specific board's full details (columns + tasks).
   * Used by useBoard. Invalidated after every mutation on that board.
   */
  list: (boardId: string) =>
    [...tasksQueryKeys.lists(), { boardId }] as const,

  /** Invalidates all task detail queries. */
  details: () => [...tasksQueryKeys.all, "detail"] as const,

  /**
   * Key for a single task detail (future use — e.g. task detail page).
   */
  detail: (id: string) =>
    [...tasksQueryKeys.details(), { id }] as const,
} as const;
