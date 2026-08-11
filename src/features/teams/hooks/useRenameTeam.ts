"use client";

/**
 * useRenameTeam — TanStack Query mutation hook for renaming a team.
 *
 * Calls renameTeamAction (Server Action) and invalidates:
 *   - teamsQueryKeys.lists()     → refreshes the team list
 *   - teamsQueryKeys.detail(teamId) → refreshes the specific team's detail
 *
 * Authorization: Company admin or platform admin. Backend enforces this.
 *
 * Error contract: The mutation never throws. Check `result.success` to
 * discriminate success from failure.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { renameTeamAction } from "../services/teamsActions";
import { teamsQueryKeys } from "./useTeams";
import type { ActionResult, Team } from "../types";

interface RenameTeamInput {
  teamId: string;
  name: string;
}

export function useRenameTeam() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<Team>, Error, RenameTeamInput>({
    mutationFn: ({ teamId, name }: RenameTeamInput) =>
      renameTeamAction(teamId, name),
    onSuccess: (_result, { teamId }) => {
      // Targeted invalidation per backend handoff: list + specific detail.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.detail(teamId) });
    },
  });
}
