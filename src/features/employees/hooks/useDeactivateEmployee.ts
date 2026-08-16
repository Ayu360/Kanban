"use client";

/**
 * useDeactivateEmployee — TanStack Query mutation hook for deactivating an employee.
 *
 * Calls deactivateEmployeeAction (Server Action) which performs the two-step
 * deactivation: DB status change first, then Auth ban.
 *
 * Cache invalidation reasoning:
 *   - List: status changes to 'deactivated', deactivatedAt is populated.
 *   - Detail: status and deactivatedAt fields change on the employee record.
 *   - Directory: deactivated employees are excluded from the employee_directory
 *     view. Invalidating ensures the picker no longer shows this employee.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 *
 * Partial success note: If the DB deactivation succeeded but the Auth ban
 * failed, the action returns an error with code UNKNOWN_ERROR and a message
 * explaining the partial state. The caller should surface this to the admin.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deactivateEmployeeAction } from "../services/employeesActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, DeactivateResult } from "../types";

interface DeactivateEmployeeInput {
  targetProfileId: string;
}

export function useDeactivateEmployee() {
  const queryClient = useQueryClient();

  return useMutation<
    ActionResult<DeactivateResult>,
    Error,
    DeactivateEmployeeInput
  >({
    mutationFn: (input: DeactivateEmployeeInput) =>
      deactivateEmployeeAction(input),
    onSuccess: (result, variables) => {
      if (result.success) {
        // Invalidate list and detail — status and deactivatedAt have changed.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.lists(),
        });
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.detail(variables.targetProfileId),
        });
        // Invalidate directory — deactivated employees must not appear in pickers.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.directory(),
        });
      }
    },
  });
}
