"use client";

/**
 * useEmployeeDirectory — TanStack Query hook for the employee directory.
 *
 * Returns the minimal employee list (id, displayName, role) for task/team
 * pickers. Available to ALL authenticated users — the `employee_directory`
 * view handles company scoping and excludes deactivated employees internally.
 *
 * Data source: `public.employee_directory` view via listEmployeeDirectoryAction
 * Server Action. Never queries profiles directly.
 *
 * Query key: ['employees', 'directory']
 *
 * staleTime: 5 minutes. The directory changes on invite (new pending employee
 * would NOT appear — view excludes pending), role-change (display only),
 * and deactivation (deactivated employees are excluded by the view).
 *
 * Mutations that affect directory visibility (deactivate/reactivate) must
 * invalidate ['employees', 'directory'].
 */

import { useQuery } from "@tanstack/react-query";
import { listEmployeeDirectoryAction } from "../services/employeesActions";
import type { Employee } from "../types";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { employeesQueryKeys } from "./useEmployees";

/**
 * Returns the employee directory for task/team member pickers.
 * Excludes deactivated employees (view-level filter, no client-side filter needed).
 *
 * Return shape:
 *   { employees: Employee[], isLoading: boolean, error: Error | null }
 */
export function useEmployeeDirectory(): {
  employees: Employee[];
  isLoading: boolean;
  error: Error | null;
} {
  const { user } = useCurrentUser();

  const { data, isLoading, error } = useQuery<Employee[], Error>({
    queryKey: employeesQueryKeys.directory(),
    queryFn: async () => {
      const result = await listEmployeeDirectoryAction();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  return {
    employees: data ?? [],
    isLoading,
    error: error ?? null,
  };
}
