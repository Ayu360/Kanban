"use client";

/**
 * useInviteEmployee — TanStack Query mutation hook for inviting a new employee.
 *
 * Calls inviteEmployeeAction (Server Action) and invalidates the full employees
 * query namespace on success so the admin list re-fetches and shows the
 * new pending employee.
 *
 * NOTE: The employee_directory is NOT invalidated on invite because the
 * `employee_directory` view excludes pending profiles. A newly invited
 * (pending) employee will appear in the admin list but not in the picker.
 * They will appear in the directory only after they accept their invite
 * (activateInvitedEmployeeAction transitions them to 'active').
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteEmployeeAction } from "../services/employeesActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, InviteEmployeeResult } from "../types";

interface InviteEmployeeInput {
  email: string;
}

export function useInviteEmployee() {
  const queryClient = useQueryClient();

  return useMutation<
    ActionResult<InviteEmployeeResult>,
    Error,
    InviteEmployeeInput
  >({
    mutationFn: (input: InviteEmployeeInput) => inviteEmployeeAction(input),
    onSuccess: (result) => {
      if (result.success) {
        // Invalidate the admin employee list so the new pending employee appears.
        // Do NOT invalidate 'directory' — pending employees are excluded from it.
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.lists(),
        });
      }
    },
  });
}
