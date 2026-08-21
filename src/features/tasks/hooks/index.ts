"use client";

/**
 * Barrel export for tasks feature hooks.
 * Import from this file to consume tasks data in components.
 *
 * Usage:
 *   import { useBoard, useCreateTask, useMoveTask, useUpdateTask, useDeleteTask } from '@/features/tasks/hooks';
 */

export { useBoard } from "./useBoard";
export { useCreateTask } from "./useCreateTask";
export { useUpdateTask } from "./useUpdateTask";
export { useMoveTask } from "./useMoveTask";
export { useDeleteTask } from "./useDeleteTask";
export { tasksQueryKeys } from "./tasksQueryKeys";
