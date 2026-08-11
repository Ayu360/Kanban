"use client";

/**
 * useTeamMembers — TanStack Query hook for a team's member list.
 *
 * Returns the members of a team, enriched with profile display data
 * (display_name, role). RLS enforces read access:
 *   - Employees can read members only of teams they belong to.
 *   - Company admins can read members of any team in their company.
 *   - Platform admins can read members of any team.
 *
 * Query key: ['teams', 'members', teamId]  (ADR-0013)
 *
 * staleTime: 1 minute. Membership changes (add/remove member) are
 *   user-initiated and should be reflected promptly. Mutations must
 *   invalidate ['teams', 'members', teamId] after add/remove operations.
 *
 * Mirror of useCurrentUser: uses the browser Supabase client directly.
 * Service layer classes are server-only and cannot run in the browser.
 */

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { TeamMember } from "../types";
import { teamsQueryKeys } from "./useTeams";

/**
 * Fetches team members from the browser, joined with profile display data.
 * auth.users.email is not accessible via public schema joins from the browser
 * (anon key). email is returned as null here; service-role reads are server-only.
 */
async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, profile_id, created_at, profiles(display_name, role)")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch team members: ${error.message}`);
  }

  type MemberRow = {
    team_id: string;
    profile_id: string;
    created_at: string;
    profiles: { display_name: string | null; role: string | null } | null;
  };

  return (data ?? []).map((row: MemberRow) => ({
    teamId: row.team_id,
    profileId: row.profile_id,
    createdAt: row.created_at,
    displayName: row.profiles?.display_name ?? null,
    email: null, // auth.users.email not accessible via anon-key public schema join
    role: row.profiles?.role ?? null,
  }));
}

/**
 * Returns the members of a team, enriched with profile display data.
 *
 * Return shape:
 *   { members: TeamMember[], isLoading: boolean, error: Error | null }
 *
 * Usage:
 *   const { members, isLoading } = useTeamMembers(teamId);
 */
export function useTeamMembers(teamId: string | undefined): {
  members: TeamMember[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery<TeamMember[], Error>({
    queryKey: teamsQueryKeys.members(teamId ?? ""),
    queryFn: () => {
      if (!teamId) return Promise.resolve([]);
      return fetchTeamMembers(teamId);
    },
    enabled: !!teamId,
    staleTime: 1 * 60 * 1000, // 1 minute — membership changes are user-initiated
    retry: false,
  });

  return {
    members: data ?? [],
    isLoading,
    error: error ?? null,
  };
}
