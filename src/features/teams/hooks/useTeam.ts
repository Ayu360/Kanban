"use client";

/**
 * useTeam — TanStack Query hook for a single team by ID.
 *
 * Returns the team if the caller has access to it (RLS enforces visibility).
 * An employee who is not a member of the team will receive null (no data).
 *
 * Query key: ['teams', 'detail', teamId]  (ADR-0013)
 *
 * staleTime: 5 minutes. Team detail (name) changes only on rename.
 *   Rename mutations must invalidate ['teams', 'detail', teamId] and
 *   ['teams', 'list', callerId] to keep the list and detail in sync.
 *
 * Mirror of useCurrentUser: uses the browser Supabase client directly.
 * Service layer classes are server-only and cannot run in the browser.
 */

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Team } from "../types";
import { teamsQueryKeys } from "./useTeams";
import { normalizePostgRESTCount } from "../utils/aggregates";

/**
 * Fetches a single team by ID from the browser.
 * Returns null if the team does not exist or the caller has no access.
 */
async function fetchTeam(teamId: string): Promise<Team | null> {
  const supabase = getSupabaseBrowserClient();

  // team_members(count) is included to satisfy the required Team.memberCount
  // field in the DTO contract. The detail page doesn't display the count, but
  // omitting it would create optional-field ambiguity at every call site. The
  // additional aggregate JOIN is negligible at MVP scale and avoids a two-tier
  // type system where list-Teams have memberCount and detail-Teams do not.
  const { data, error } = await supabase
    .from("teams")
    .select("id, company_id, name, created_at, updated_at, team_members(count)")
    .eq("id", teamId)
    .single();

  if (error) {
    // PGRST116 = no rows — team not found or not visible to caller
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to fetch team: ${error.message}`);
  }

  if (!data) return null;

  const countAggregate = (data as unknown as { team_members?: Array<{ count: number | string }> }).team_members;

  return {
    id: data.id,
    companyId: data.company_id,
    name: data.name,
    memberCount: normalizePostgRESTCount(countAggregate?.[0]?.count),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Returns a single team by ID, or null if not found / no access.
 *
 * Return shape:
 *   { team: Team | null, isLoading: boolean, error: Error | null }
 *
 * Usage:
 *   const { team, isLoading } = useTeam(teamId);
 *   if (isLoading) return <Spinner />;
 *   if (!team) return <NotFound />;
 */
export function useTeam(teamId: string | undefined): {
  team: Team | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery<Team | null, Error>({
    queryKey: teamsQueryKeys.detail(teamId ?? ""),
    queryFn: () => {
      if (!teamId) return Promise.resolve(null);
      return fetchTeam(teamId);
    },
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000, // 5 minutes — team name changes rarely
    retry: false,
  });

  return {
    team: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
