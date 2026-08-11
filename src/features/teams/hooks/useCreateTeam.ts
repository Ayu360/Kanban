"use client";

/**
 * useCreateTeam — TanStack Query mutation hook for creating a new team.
 *
 * Calls createTeamAction (Server Action) and invalidates the full teams query
 * namespace on success so the list re-fetches immediately.
 *
 * Authorization: Company admin or platform admin. Backend enforces this.
 * The component must pass user.companyId from useCurrentUser() — never from
 * a form field or URL parameter (backend contract, security requirement).
 *
 * Error contract: The mutation never throws. Check `result.success` to
 * discriminate success from failure. On failure, `result.error` contains
 * `{ code, message }` for display.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTeamAction } from "../services/teamsActions";
import { teamsQueryKeys } from "./useTeams";
import type { ActionResult, CreateTeamResult } from "../types";

interface CreateTeamInput {
  companyId: string;
  name: string;
}

export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation<ActionResult<CreateTeamResult>, Error, CreateTeamInput>({
    mutationFn: (input: CreateTeamInput) => createTeamAction(input),
    onSuccess: () => {
      // Broad invalidation: clears list, detail, and members caches.
      // This is intentional per the backend handoff cache invalidation table.
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.all });
    },
  });
}
