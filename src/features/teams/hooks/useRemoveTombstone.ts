"use client";

/**
 * useRemoveTombstone — TanStack Query mutation hook for removing a tombstone
 * row from a team.
 *
 * A tombstone row is a team_members row whose profile_id is NULL because the
 * employee who held that membership slot has been hard-deleted (FR-15, PRD 05).
 * Tombstone rows cannot be removed via useRemoveTeamMember because the
 * null profile_id would match ALL tombstones in the team — a footgun.
 * This hook routes to removeTombstoneAction which uses the surrogate memberRowId
 * (team_members.id) to target a specific tombstone row safely.
 *
 * Authorization: Company admin or platform admin. Backend enforces this.
 *
 * Invalidation: same as useRemoveTeamMember — invalidates the team's members
 * list, the teams list, and the team detail so memberCount stays accurate.
 *
 * Error contract: The mutation never throws. Check `result.success`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { removeTombstoneAction } from "../services/teamsActions";
import { teamsQueryKeys } from "./useTeams";
import type { ActionResult } from "../types";

interface RemoveTombstoneInput {
  teamId: string;
  memberRowId: string;
}

export function useRemoveTombstone() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<void>, Error, RemoveTombstoneInput>({
    mutationFn: ({ teamId, memberRowId }: RemoveTombstoneInput) =>
      removeTombstoneAction(teamId, memberRowId),
    onSuccess: (_result, { teamId }) => {
      // Invalidate the affected team's members list so the member list re-fetches.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.members(teamId) });
      // Invalidate the teams list and team detail so memberCount stays accurate.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.detail(teamId) });
    },
  });
}
