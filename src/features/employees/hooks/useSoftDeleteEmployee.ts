"use client";

/**
 * useSoftDeleteEmployee — TanStack Query mutation hook for scheduling an
 * employee for deletion in the 24-hour grace window.
 *
 * Calls softDeleteEmployeeAction which:
 *   1. Runs the soft_delete_employee RPC (sets deletion_scheduled_at).
 *   2. Bans the auth account (revokes login access immediately).
 *
 * Cache invalidation pattern (FE-1 / useRemoveTombstone):
 *   Unconditional invalidation in onSuccess. The caller inspects result.success
 *   and surfaces errors. This matches the pre-existing FE-1 tombstone pattern
 *   (documented as a known inconsistency with the older deactivate/reactivate
 *   hooks, deferred for a future cleanup PR).
 *
 *   Invalidates:
 *     - lists()     — deletionScheduledAt is populated; list view must refresh.
 *     - detail(id)  — same field change on the detail record.
 *     - directory() — soft-deleted employees (though still "active" in status)
 *       should not appear in pickers once their access is revoked.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 *
 * Race note: If the Action returns success but with a ban failure, it still
 * returns success (deletion was scheduled; ban failure is an ops concern).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { softDeleteEmployeeAction } from "../services/employeesLifecycleActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, SoftDeleteResult } from "../types";

export function useSoftDeleteEmployee() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<SoftDeleteResult>, Error, string>({
    mutationFn: (targetProfileId: string) =>
      softDeleteEmployeeAction(targetProfileId),
    onSuccess: (_result, targetProfileId) => {
      // Unconditional invalidation (FE-1 pattern — see JSDoc above).
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
