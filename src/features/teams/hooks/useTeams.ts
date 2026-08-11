"use client";

/**
 * useTeams — TanStack Query hook for the current caller's team list.
 *
 * Returns the teams visible to the authenticated caller:
 *   - Platform admin: all teams in their company (MVP; cross-company in post-MVP).
 *   - Company admin: all teams in their company.
 *   - Employee: only teams they are a member of.
 *
 * RLS on the Supabase anon client enforces these visibility rules
 * automatically — no application-layer filtering is needed here.
 *
 * Query key: ['teams', 'list', callerId]  (ADR-0013)
 *   Keyed on callerId so that a session change (different user logging in)
 *   triggers a fresh fetch rather than returning a stale prior user's teams.
 *
 * staleTime: 2 minutes. Team lists change when an admin creates, renames,
 *   or deletes a team. Mutations must invalidate ['teams'] to force a refresh.
 *
 * The hook does not redirect — redirection is the middleware's job (ADR-0011).
 * It returns a stable { teams, isLoading, error } shape.
 *
 * Mirror of useCurrentUser: uses the browser Supabase client directly.
 * Service layer classes are server-only and cannot run in the browser.
 */

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Team } from "../types";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { normalizePostgRESTCount } from "../utils/aggregates";

/** Centralized query key factory for the teams feature. ADR-0013. */
export const teamsQueryKeys = {
  all: ["teams"] as const,
  lists: () => ["teams", "list"] as const,
  list: (callerId: string) => ["teams", "list", callerId] as const,
  details: () => ["teams", "detail"] as const,
  detail: (teamId: string) => ["teams", "detail", teamId] as const,
  members: (teamId: string) => ["teams", "members", teamId] as const,
};

/**
 * Fetches teams visible to the caller from the browser.
 * RLS on the anon client enforces role-based visibility automatically.
 *
 * Filters by companyId so that the query only touches the caller's tenant.
 * This is additive to RLS — provides clarity and avoids full-table scans.
 */
async function fetchTeams(companyId: string): Promise<Team[]> {
  const supabase = getSupabaseBrowserClient();

  // team_members(count) is a PostgREST embedded aggregate.
  // Result shape per row: { ..., team_members: [{ count: number | string }] }
  const { data, error } = await supabase
    .from("teams")
    .select("id, company_id, name, created_at, updated_at, team_members(count)")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch teams: ${error.message}`);
  }

  // The Supabase client types don't model the embedded aggregate shape.
  // We cast to our local row type which includes the count aggregate array.
  type TeamRowWithCount = {
    id: string;
    company_id: string;
    name: string;
    created_at: string;
    updated_at: string;
    team_members?: Array<{ count: number | string }> | null;
  };

  const rows = (data ?? []) as unknown as TeamRowWithCount[];

  return rows.map((row) => {
    return {
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      memberCount: normalizePostgRESTCount(row.team_members?.[0]?.count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Returns the list of teams visible to the current authenticated caller.
 *
 * Return shape:
 *   { teams: Team[], isLoading: boolean, error: Error | null }
 *
 * Usage:
 *   const { teams, isLoading } = useTeams();
 */
export function useTeams(): {
  teams: Team[];
  isLoading: boolean;
  error: Error | null;
} {
  const { user } = useCurrentUser();

  const { data, isLoading, error } = useQuery<Team[], Error>({
    queryKey: teamsQueryKeys.list(user?.id ?? ""),
    queryFn: () => {
      if (!user) return Promise.resolve([]);
      return fetchTeams(user.companyId);
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: false,
  });

  return {
    teams: data ?? [],
    isLoading,
    error: error ?? null,
  };
}
