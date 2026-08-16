"use client";

/**
 * useReactivateEmployee — TanStack Query mutation hook for reactivating an employee.
 *
 * Calls reactivateEmployeeAction (Server Action) which performs the two-step
 * reactivation: DB status change first, then Auth unban. If the Auth unban
 * fails, a compensating DB rollback is attempted and an error is returned.
 *
 * Cache invalidation reasoning:
 *   - List: status changes back to 'active', deactivatedAt is cleared.
 *   - Detail: status and deactivatedAt fields change on the employee record.
 *   - Directory: the newly active employee should reappear in pickers.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reactivateEmployeeAction } from "../services/employeesActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, ReactivateResult } from "../types";

interface ReactivateEmployeeInput {
  targetProfileId: string;
}

export function useReactivateEmployee() {
  const queryClient = useQueryClient();

  return useMutation<
    ActionResult<ReactivateResult>,
    Error,
    ReactivateEmployeeInput
  >({
    mutationFn: (input: ReactivateEmployeeInput) =>
      reactivateEmployeeAction(input),
    onSuccess: (result, variables) => {
      if (result.success) {
        // Invalidate list and detail — status has changed to active, deactivatedAt cleared.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.lists(),
        });
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.detail(variables.targetProfileId),
        });
        // Invalidate directory — the reactivated employee should appear again in pickers.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.directory(),
        });
      }
    },
  });
}
