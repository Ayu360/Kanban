"use client";

/**
 * useHardDeleteEmployee — TanStack Query mutation hook for immediately and
 * irreversibly deleting an employee's profile and auth identity.
 *
 * Calls hardDeleteEmployeeAction which:
 *   1. Bans the auth account first (prevents JWT from remaining valid).
 *   2. Runs the hard_delete_employee RPC (deletes the profiles row).
 *   3. Deletes the auth.users row.
 *
 * Cache invalidation pattern (FE-1 / useRemoveTombstone):
 *   Unconditional invalidation in onSuccess. The caller inspects result.success
 *   and surfaces errors. This matches the pre-existing FE-1 tombstone pattern
 *   (documented as a known inconsistency with the older deactivate/reactivate
 *   hooks, deferred for a future cleanup PR).
 *
 *   Invalidates:
 *     - lists()     — employee row is gone; list must not show it.
 *     - detail(id)  — detail record is gone.
 *     - directory() — employee must not appear in pickers.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 *
 * IMPORTANT: This action is irreversible. The caller MUST show a strong
 * confirmation dialog (variant='destructive') before invoking.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hardDeleteEmployeeAction } from "../services/employeesLifecycleActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, HardDeleteResult } from "../types";

export function useHardDeleteEmployee() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<HardDeleteResult>, Error, string>({
    mutationFn: (targetProfileId: string) =>
      hardDeleteEmployeeAction(targetProfileId),
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
