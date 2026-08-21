"use client";

/**
 * useEmployees — TanStack Query hook for the admin employee list.
 *
 * Returns the full employee list (including status, email, deactivatedAt)
 * for the caller's company. Restricted to company admins and platform admins.
 *
 * Data source: `public.admin_employee_list` view via the listEmployeesAction
 * Server Action (service-role client). Never queries profiles directly.
 *
 * Query key: ['employees', 'list', companyId]
 *
 * staleTime: 2 minutes. Employee lists change on invite/role-change/deactivate.
 * Mutations must invalidate ['employees'] to force a refresh.
 *
 * The hook does not redirect — middleware handles session enforcement.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listEmployeesAction } from "../services/employeesActions";
import type { AdminEmployee } from "../types";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";

/**
 * Grace-window poll interval (FE-4 / PRD 05 EC-04).
 *
 * When at least one employee is in the 24-hour soft-delete grace window
 * (deletionScheduledAt !== null), the pg_cron job may promote the deletion
 * at any point. Polling at 30s ensures the admin sees the row disappear
 * without a hard refresh.
 *
 * refetchInterval is set to false when no grace-window rows are present to
 * avoid unnecessary background requests during normal operation.
 */
const GRACE_WINDOW_POLL_INTERVAL_MS = 30_000;

/** Centralized query key factory for the employees feature. ADR-0013. */
export const employeesQueryKeys = {
  all: ["employees"] as const,
  lists: () => ["employees", "list"] as const,
  list: (companyId: string) => ["employees", "list", companyId] as const,
  details: () => ["employees", "detail"] as const,
  detail: (profileId: string) => ["employees", "detail", profileId] as const,
  directory: () => ["employees", "directory"] as const,
};

/**
 * Returns the admin employee list for the current caller's company.
 *
 * Only enabled for company admins and platform admins.
 * Plain employees get an empty list (the action returns FORBIDDEN,
 * but the hook is typically not rendered for non-admins).
 *
 * Return shape:
 *   { employees: AdminEmployee[], isLoading: boolean, error: Error | null }
 */
export function useEmployees(): {
  employees: AdminEmployee[];
  isLoading: boolean;
  error: Error | null;
} {
  const { user } = useCurrentUser();

  const isAdmin = !!user && (user.isPlatformAdmin || user.role === "admin");

  const { data, isLoading, error } = useQuery<AdminEmployee[], Error>({
    queryKey: employeesQueryKeys.list(user?.companyId ?? ""),
    queryFn: async () => {
      if (!user?.companyId) return [];

      const result = await listEmployeesAction(user.companyId);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: !!user && isAdmin,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: false,
    // FE-4 (PRD 05 EC-04): poll while any row is in the soft-delete grace window
    // so the admin sees the cron-promoted deletion without a hard refresh.
    // TanStack Query v5 passes the Query object; we read state.data from it.
    refetchInterval: (query) => {
      const hasScheduledDeletion = (query.state.data as AdminEmployee[] | undefined)?.some(
        (e) => e.deletionScheduledAt !== null
      );
      return hasScheduledDeletion ? GRACE_WINDOW_POLL_INTERVAL_MS : false;
    },
  });

  return {
    employees: data ?? [],
    isLoading,
    error: error ?? null,
  };
}

// Re-export queryClient helper for mutation hooks that need to invalidate
export { useQueryClient };
