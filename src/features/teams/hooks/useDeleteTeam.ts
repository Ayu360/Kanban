"use client";

/**
 * useDeleteTeam — TanStack Query mutation hook for deleting a team.
 *
 * Calls deleteTeamAction (Server Action) and invalidates the full teams
 * namespace on success (list, detail, members all become stale).
 *
 * SECURITY: Only teamId is passed to the action — the action derives
 * companyId from the authenticated session server-side. Never pass companyId
 * from the client to this action.
 *
 * Authorization: Company admin or platform admin. Backend enforces this.
 *
 * Error contract: The mutation never throws. Check `result.success`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTeamAction } from "../services/teamsActions";
import { teamsQueryKeys } from "./useTeams";
import type { ActionResult } from "../types";

export function useDeleteTeam() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<void>, Error, string>({
    mutationFn: (teamId: string) => deleteTeamAction(teamId),
    onSuccess: () => {
      // Broad invalidation: the team is gone, so list/detail/members are all stale.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.all });
    },
  });
}
