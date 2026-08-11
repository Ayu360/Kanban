"use client";

/**
 * useRemoveTeamMember — TanStack Query mutation hook for removing a member from a team.
 *
 * Calls removeTeamMemberAction (Server Action) and invalidates the team's
 * members cache on success so the member list re-fetches.
 *
 * Idempotent: removing a non-member returns success with no error.
 *
 * Authorization: Company admin or platform admin. Backend enforces this.
 *
 * Error contract: The mutation never throws. Check `result.success`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { removeTeamMemberAction } from "../services/teamsActions";
import { teamsQueryKeys } from "./useTeams";
import type { ActionResult } from "../types";

interface RemoveTeamMemberInput {
  teamId: string;
  profileId: string;
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<void>, Error, RemoveTeamMemberInput>({
    mutationFn: ({ teamId, profileId }: RemoveTeamMemberInput) =>
      removeTeamMemberAction(teamId, profileId),
    onSuccess: (_result, { teamId }) => {
      // Invalidate the affected team's members list so the member list re-fetches.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.members(teamId) });
      // Invalidate the teams list and the team detail so memberCount stays accurate
      // on TeamCard after a removal. Scoped to list and detail — does not touch unrelated queries.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.detail(teamId) });
    },
  });
}
