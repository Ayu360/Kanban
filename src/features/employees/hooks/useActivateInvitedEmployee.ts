"use client";

/**
 * useActivateInvitedEmployee — TanStack Query mutation hook for invite acceptance.
 *
 * Calls activateInvitedEmployeeAction (Server Action) which invokes the
 * `activate_invited_employee` RPC from the invited user's authenticated session.
 *
 * Usage: called from the invite-acceptance callback page immediately after
 * Supabase Auth establishes the session (the user clicked the magic link
 * and set their password).
 *
 * Idempotent: can be safely called multiple times if the callback page fires
 * more than once (already-active is a no-op at the RPC level).
 *
 * Cache invalidation:
 *   - Invalidates the employee directory so the newly active employee appears
 *     in task/team pickers for other users immediately.
 *   - Invalidates the admin list so the admin sees status change from
 *     'pending' to 'active' without a manual refresh.
 *   - No need to invalidate useCurrentUser — the JWT will reflect the new
 *     status on the next refresh (within 1 hour), and the user is being
 *     redirected to the app after this action completes.
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { activateInvitedEmployeeAction } from "../services/employeesActions";
import { employeesQueryKeys } from "./useEmployees";
import type { ActionResult, ActivateInvitedResult } from "../types";

export function useActivateInvitedEmployee() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<ActivateInvitedResult>, Error, void>({
    mutationFn: () => activateInvitedEmployeeAction(),
    onSuccess: (result) => {
      if (result.success) {
        // Invalidate the full employees namespace so all views refresh:
        // admin list (pending → active), directory (newly active employee appears).
        queryClient.invalidateQueries({
          queryKey: employeesQueryKeys.all,
        });
      }
    },
  });
}
