"use client";

/**
 * useUndoScheduledDeletion — TanStack Query mutation hook for cancelling a
 * soft-delete grace window and restoring an employee's access.
 *
 * Calls undoScheduledDeletionAction which:
 *   1. Runs the cancel_scheduled_deletion RPC (clears deletion_scheduled_at).
 *   2. Unbans the auth account (restores login access).
 *
 * Cache invalidation pattern (FE-1 / useRemoveTombstone):
 *   Unconditional invalidation in onSuccess. The caller inspects result.success
 *   and handles the three possible outcomes:
 *     (A) result.success === true && result.data.cancelled === true
 *         → Deletion was cancelled. Show success feedback.
 *     (B) result.success === true && result.data.cancelled === false
 *                                 && result.data.reason === 'already_deleted'
 *         → RACE CASE: pg_cron promoted the deletion before cancel arrived.
 *           Show: "This account has already been deleted and cannot be restored."
 *           The employee row will disappear after the unconditional invalidation
 *           above triggers a list refetch.
 *     (C) result.success === false
 *         → Action-level error. Surface result.error.message to the admin.
 *
 * Invalidates:
 *     - lists()     — deletionScheduledAt is cleared (or row is gone on race).
 *     - detail(id)  — same field change on the detail record.
 *     - directory() — employee may reappear in pickers after unban.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { undoScheduledDeletionAction } from "../services/employeesLifecycleActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, UndoScheduledDeletionResult } from "../types";

export function useUndoScheduledDeletion() {
  const queryClient = useQueryClient();

  return useMutation<
    ActionResult<UndoScheduledDeletionResult>,
    Error,
    string
  >({
    mutationFn: (targetProfileId: string) =>
      undoScheduledDeletionAction(targetProfileId),
    onSuccess: (_result, targetProfileId) => {
      // Unconditional invalidation (FE-1 pattern).
      // On the race case (already_deleted), the list refetch will make the
      // deleted row disappear, which is the desired UX.
      queryClient.invalidateQueries({
        queryKey: employeesQueryKeys.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: employeesQueryKeys.detail(targetProfileId),
      });
      queryClient.invalidateQueries({
        queryKey: employeesQueryKeys.directory(),
      });
    },
  });
}
