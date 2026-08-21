"use client";

/**
 * useCancelInvite — TanStack Query mutation hook for cancelling a pending
 * invitation and removing the associated account.
 *
 * Calls cancelInviteAction which:
 *   1. Runs the cancel_invite RPC (writes audit log + deletes profiles row).
 *   2. Deletes the auth.users row (silent on failure — OQ-3 decision;
 *      orphaned auth rows are swept by the auth-sweep cron endpoint).
 *
 * Cache invalidation pattern (FE-1 / useRemoveTombstone):
 *   Unconditional invalidation in onSuccess. The caller inspects result.success
 *   and surfaces errors. Matches the pre-existing FE-1 tombstone pattern
 *   (documented inconsistency with older hooks; deferred for future cleanup PR).
 *
 *   Invalidates:
 *     - lists() — the pending employee row is gone; list must not show it.
 *     - NOTE: directory is NOT invalidated — pending employees are excluded
 *       from the employee_directory view, so no directory refetch is needed.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 *
 * Only valid on employees with status === 'pending'. The backend enforces this;
 * the UI MUST also gate the action to pending rows only.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelInviteAction } from "../services/employeesLifecycleActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, CancelInviteResult } from "../types";

export function useCancelInvite() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<CancelInviteResult>, Error, string>({
    mutationFn: (targetProfileId: string) =>
      cancelInviteAction(targetProfileId),
    onSuccess: () => {
      // Unconditional invalidation (FE-1 pattern — see JSDoc above).
      // Only invalidate lists — pending employees are not in the directory.
      queryClient.invalidateQueries({
        queryKey: employeesQueryKeys.lists(),
      });
    },
  });
}
