"use client";

/**
 * useBoardIdByTeam — resolves a boardId from a teamId.
 *
 * Each team has exactly one board, seeded at creation via the
 * `create_team_with_board` RPC (see TeamsRepository.createTeam).
 * This hook performs a direct SELECT on the `boards` table, filtered
 * by `team_id`. RLS ensures the caller can only see boards for teams
 * they belong to.
 *
 * Returns null when:
 *   - teamId is falsy (hook is disabled)
 *   - No board exists for the team (should not happen in practice — boards
 *     are seeded atomically at team creation, but we handle it gracefully)
 *   - The caller has no RLS access to this team's board
 *
 * Query key: ['tasks', 'boardByTeam', teamId]
 *   Separated from the main board list key so it can be stale-for-longer
 *   (boardId never changes for a given team). Invalidated on team deletion
 *   only (not needed for task mutations).
 */

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

async function fetchBoardIdByTeam(teamId: string): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("boards")
    .select("id")
    .eq("team_id", teamId)
    .single();

  if (error) {
    // PGRST116 = no rows found — board not yet seeded (edge case) or no access
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to resolve boardId for team ${teamId}: ${error.message}`);
  }

  return data?.id ?? null;
}

export function useBoardIdByTeam(teamId: string | undefined): {
  boardId: string | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery<string | null, Error>({
    queryKey: ["tasks", "boardByTeam", teamId ?? ""],
    queryFn: () => fetchBoardIdByTeam(teamId!),
    enabled: !!teamId,
    // BoardId is immutable after team creation — 10 minute stale time is safe.
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  return {
    boardId: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
