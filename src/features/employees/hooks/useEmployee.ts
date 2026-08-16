"use client";

/**
 * useEmployee — TanStack Query hook for a single employee by profile ID.
 *
 * Returns the full AdminEmployee record for an individual employee.
 * Restricted to company admins and platform admins.
 *
 * Query key: ['employees', 'detail', profileId]
 *
 * staleTime: 5 minutes. Individual employee details change on role-change
 * or deactivation. Mutations must invalidate this key accordingly.
 */

import { useQuery } from "@tanstack/react-query";
import { getEmployeeAction } from "../services/employeesActions";
import type { AdminEmployee } from "../types";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { employeesQueryKeys } from "./useEmployees";

/**
 * Returns a single employee's full record by profile ID, or null if not found.
 *
 * Return shape:
 *   { employee: AdminEmployee | null, isLoading: boolean, error: Error | null }
 */
export function useEmployee(profileId: string | undefined): {
  employee: AdminEmployee | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { user } = useCurrentUser();

  const isAdmin = !!user && (user.isPlatformAdmin || user.role === "admin");

  const { data, isLoading, error } = useQuery<AdminEmployee | null, Error>({
    // Empty string fallback when profileId is undefined keeps the key shape
    // stable (avoids key-length mismatches in TanStack Query internals).
    // The query is always disabled when profileId is falsy via the `enabled`
    // flag below, so this key is never actually fetched.
    // This matches the project convention in useTeam.ts (teamsQueryKeys.detail(teamId ?? "")).
    queryKey: employeesQueryKeys.detail(profileId ?? ""),
    queryFn: async () => {
      if (!profileId) return null;

      const result = await getEmployeeAction(profileId);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: !!profileId && !!user && isAdmin,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  return {
    employee: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
