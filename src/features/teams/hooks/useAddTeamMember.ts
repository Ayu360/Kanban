"use client";

/**
 * useAddTeamMember — TanStack Query mutation hook for adding a member to a team.
 *
 * Calls addTeamMemberAction (Server Action) and invalidates the team's
 * members cache on success so the member list re-fetches.
 *
 * Idempotent: adding an already-existing member returns success with no error.
 *
 * Authorization: Company admin or platform admin. Backend enforces this.
 *
 * Error contract: The mutation never throws. Check `result.success`.
 * Notable error codes:
 *   CROSS_COMPANY — profileId belongs to a different company
 *   NOT_FOUND     — team or profile does not exist
 *   FORBIDDEN     — caller is an employee
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addTeamMemberAction } from "../services/teamsActions";
import { teamsQueryKeys } from "./useTeams";
import type { ActionResult } from "../types";

interface AddTeamMemberInput {
  teamId: string;
  profileId: string;
}

export function useAddTeamMember() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<void>, Error, AddTeamMemberInput>({
    mutationFn: ({ teamId, profileId }: AddTeamMemberInput) =>
      addTeamMemberAction(teamId, profileId),
    onSuccess: (_result, { teamId }) => {
      // Invalidate the affected team's members list so the member list re-fetches.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.members(teamId) });
      // Invalidate the teams list and the team detail so memberCount stays accurate
      // on TeamCard after an add. Scoped to list and detail — does not touch unrelated queries.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.detail(teamId) });
    },
  });
}
