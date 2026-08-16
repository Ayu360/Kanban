"use client";

/**
 * useChangeEmployeeRole — TanStack Query mutation hook for role promotion/demotion.
 *
 * Calls changeEmployeeRoleAction (Server Action) and invalidates the employee
 * list and the specific employee's detail cache on success.
 *
 * Cache invalidation reasoning:
 *   - List: the role badge changes in the employee management table.
 *   - Detail: the role field changes on the individual employee record.
 *   - Directory: role is exposed in the directory view — invalidate so pickers
 *     reflect the updated role immediately (relevant for admin-to-employee
 *     transitions where downstream pickers show role context).
 *
 * No Auth-layer side effect needed — role changes do not affect session state.
 * The affected user's role will be reflected on their next JWT refresh.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changeEmployeeRoleAction } from "../services/employeesActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, ChangeRoleResult } from "../types";

interface ChangeEmployeeRoleInput {
  targetProfileId: string;
  newRole: "admin" | "employee";
}

export function useChangeEmployeeRole() {
  const queryClient = useQueryClient();

  return useMutation<
    ActionResult<ChangeRoleResult>,
    Error,
    ChangeEmployeeRoleInput
  >({
    mutationFn: (input: ChangeEmployeeRoleInput) =>
      changeEmployeeRoleAction(input),
    onSuccess: (result, variables) => {
      if (result.success) {
        // Invalidate the admin list (role badge changes).
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.lists(),
        });
        // Invalidate the detail for the specific employee.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.detail(variables.targetProfileId),
        });
        // Invalidate directory so pickers reflect updated role.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.directory(),
        });
      }
    },
  });
}
