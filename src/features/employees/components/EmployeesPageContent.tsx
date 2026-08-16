"use client";

/**
 * EmployeesPageContent — client-side content for the /employees route.
 *
 * Orchestrates:
 *   - useEmployees (read — admin-only)
 *   - useChangeEmployeeRole, useDeactivateEmployee, useReactivateEmployee (mutations)
 *   - Role-based UI: admin sees management controls; employee sees read-only directory view
 *   - Loading / error / empty states
 *   - Client-side search/filter by name or email
 *   - Dismissible error banners (Teams pattern)
 *
 * State managed here (UI state — NOT server state):
 *   - inviteModalOpen: boolean
 *   - roleTarget: AdminEmployee | null (who is being role-changed)
 *   - roleDirection: 'promote' | 'demote' | null
 *   - statusTarget: AdminEmployee | null (who is being deactivated/reactivated)
 *   - statusAction: 'deactivate' | 'reactivate' | null
 *   - searchQuery: string
 *   - banner error messages (per action, dismissible)
 *   - per-employee in-flight Sets (role and status, to support concurrent actions)
 *
 * Server state lives entirely in TanStack Query (useEmployees, mutation hooks).
 * No employee data is duplicated into Redux.
 *
 * Non-admin employees: shown a read-only directory prompt (no management controls).
 * The directory itself lives in separate feature components; this page just shows
 * a "no access" message per the Teams pattern.
 */

import { useState } from "react";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { useEmployees } from "../hooks/useEmployees";
import { useChangeEmployeeRole } from "../hooks/useChangeEmployeeRole";
import { useDeactivateEmployee } from "../hooks/useDeactivateEmployee";
import { useReactivateEmployee } from "../hooks/useReactivateEmployee";
import EmployeeCard from "./EmployeeCard";
import InviteEmployeeModal from "./InviteEmployeeModal";
import EmployeeConfirmDialog from "./EmployeeConfirmDialog";
import type { AdminEmployee } from "../types";

export default function EmployeesPageContent() {
  const { user } = useCurrentUser();
  const { employees, isLoading, error } = useEmployees();

  const changeRoleMutation = useChangeEmployeeRole();
  const deactivateMutation = useDeactivateEmployee();
  const reactivateMutation = useReactivateEmployee();

  const isAdmin = !!user && (user.role === "admin" || user.isPlatformAdmin);

  // ---- UI state ----
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Role-change dialog state.
  const [roleTarget, setRoleTarget] = useState<AdminEmployee | null>(null);
  const [roleDirection, setRoleDirection] = useState<"promote" | "demote" | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Status-change dialog state.
  const [statusTarget, setStatusTarget] = useState<AdminEmployee | null>(null);
  const [statusAction, setStatusAction] = useState<"deactivate" | "reactivate" | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Per-employee in-flight tracking (concurrent action isolation, Teams pattern).
  const [pendingRoleIds, setPendingRoleIds] = useState<Set<string>>(new Set());
  const [pendingStatusIds, setPendingStatusIds] = useState<Set<string>>(new Set());

  // ---- Handlers ----

  const handlePromote = (emp: AdminEmployee) => {
    setRoleError(null);
    setRoleDirection("promote");
    setRoleTarget(emp);
  };

  const handleDemote = (emp: AdminEmployee) => {
    setRoleError(null);
    setRoleDirection("demote");
    setRoleTarget(emp);
  };

  const handleRoleConfirm = () => {
    if (!roleTarget || !roleDirection) return;
    if (pendingRoleIds.has(roleTarget.id)) return;
    setRoleError(null);

    const targetId = roleTarget.id;
    setPendingRoleIds((prev) => new Set(prev).add(targetId));

    changeRoleMutation.mutate(
      {
        targetProfileId: targetId,
        newRole: roleDirection === "promote" ? "admin" : "employee",
      },
      {
        onSuccess: (result) => {
          setPendingRoleIds((prev) => {
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          if (result.success) {
            setRoleTarget(null);
            setRoleDirection(null);
          } else {
            setRoleError(result.error.message);
            setRoleTarget(null);
            setRoleDirection(null);
          }
        },
        onError: () => {
          setPendingRoleIds((prev) => {
            const next = new Set(prev);
            next.delete(targetId);
            return next;
          });
          setRoleError("Failed to change role. Please try again.");
          setRoleTarget(null);
          setRoleDirection(null);
        },
      }
    );
  };

  const handleDeactivate = (emp: AdminEmployee) => {
    setStatusError(null);
    setStatusAction("deactivate");
    setStatusTarget(emp);
  };

  const handleReactivate = (emp: AdminEmployee) => {
    setStatusError(null);
    setStatusAction("reactivate");
    setStatusTarget(emp);
  };

  const handleStatusConfirm = () => {
    if (!statusTarget || !statusAction) return;
    if (pendingStatusIds.has(statusTarget.id)) return;
    setStatusError(null);

    const targetId = statusTarget.id;
    setPendingStatusIds((prev) => new Set(prev).add(targetId));

    if (statusAction === "deactivate") {
      deactivateMutation.mutate(
        { targetProfileId: targetId },
        {
          onSuccess: (result) => {
            setPendingStatusIds((prev) => {
              const next = new Set(prev);
              next.delete(targetId);
              return next;
            });
            if (result.success) {
              setStatusTarget(null);
              setStatusAction(null);
            } else {
              // Surface UNKNOWN_ERROR (partial deactivation — M-2) verbatim.
              setStatusError(result.error.message);
              setStatusTarget(null);
              setStatusAction(null);
            }
          },
          onError: () => {
            setPendingStatusIds((prev) => {
              const next = new Set(prev);
              next.delete(targetId);
              return next;
            });
            setStatusError("Failed to deactivate employee. Please try again.");
            setStatusTarget(null);
            setStatusAction(null);
          },
        }
      );
    } else {
      reactivateMutation.mutate(
        { targetProfileId: targetId },
        {
          onSuccess: (result) => {
            setPendingStatusIds((prev) => {
              const next = new Set(prev);
              next.delete(targetId);
              return next;
            });
            if (result.success) {
              setStatusTarget(null);
              setStatusAction(null);
            } else {
              setStatusError(result.error.message);
              setStatusTarget(null);
              setStatusAction(null);
            }
          },
          onError: () => {
            setPendingStatusIds((prev) => {
              const next = new Set(prev);
              next.delete(targetId);
              return next;
            });
            setStatusError("Failed to reactivate employee. Please try again.");
            setStatusTarget(null);
            setStatusAction(null);
          },
        }
      );
    }
  };

  // ---- Non-admin view ----
  if (!isLoading && !isAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
          <svg
            className="h-7 w-7 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Access restricted
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Only company admins can manage employees.
        </p>
      </div>
    );
  }

  // ---- Loading state ----
  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Loading employees...
        </p>
      </div>
    );
  }

  // ---- Error state ----
  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          Failed to load employees. Please refresh the page.
        </div>
      </div>
    );
  }

  // ---- Client-side search filter ----
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEmployees =
    normalizedQuery.length === 0
      ? employees
      : employees.filter((emp) => {
          const name = (emp.displayName ?? "").toLowerCase();
          const email = (emp.email ?? "").toLowerCase();
          return name.includes(normalizedQuery) || email.includes(normalizedQuery);
        });

  // ---- Role dialog config ----
  const roleDialogTitle =
    roleDirection === "promote" ? "Promote to Admin" : "Demote to Employee";
  const roleDialogDescription =
    roleDirection === "promote"
      ? `Promote ${roleTarget?.displayName ?? roleTarget?.email ?? "this employee"} to Admin? They will gain full management capabilities, including the ability to invite, promote, and deactivate employees.`
      : `Demote ${roleTarget?.displayName ?? roleTarget?.email ?? "this admin"} to Employee? They will lose all management capabilities. They will need to sign out and back in for this change to take effect.`;

  // ---- Status dialog config ----
  const statusDialogTitle =
    statusAction === "deactivate" ? "Deactivate employee" : "Reactivate employee";
  const statusDialogDescription =
    statusAction === "deactivate"
      ? `Deactivate ${statusTarget?.displayName ?? statusTarget?.email ?? "this employee"}? They will lose the ability to log in within the hour. Their tasks and history are preserved.`
      : `Reactivate ${statusTarget?.displayName ?? statusTarget?.email ?? "this employee"}? They will be able to log in again with their existing credentials.`;

  const isStatusDialogPending =
    statusAction === "deactivate"
      ? deactivateMutation.isPending
      : reactivateMutation.isPending;

  // ---- Render ----
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Employees
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage your company&apos;s employees — invite, promote, and deactivate.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteModalOpen(true)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          Invite employee
        </button>
      </div>

      {/* Dismissible role-change error banner */}
      {roleError && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          <span>{roleError}</span>
          <button
            type="button"
            onClick={() => setRoleError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 text-red-500 transition hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-red-400 dark:hover:bg-red-900/40 dark:hover:text-red-300"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Dismissible status-change error banner */}
      {statusError && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          <span>{statusError}</span>
          <button
            type="button"
            onClick={() => setStatusError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 text-red-500 transition hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-red-400 dark:hover:bg-red-900/40 dark:hover:text-red-300"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Search / filter */}
      {employees.length > 0 && (
        <div className="mb-4 relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          <label htmlFor="employee-search" className="sr-only">
            Search employees
          </label>
          <input
            id="employee-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
          />
        </div>
      )}

      {/* Employee list */}
      {employees.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-16 text-center dark:border-slate-600">
          <div className="mb-3 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
              <svg
                className="h-6 w-6 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No employees yet.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Invite someone to get started.
          </p>
          <button
            type="button"
            onClick={() => setInviteModalOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Invite employee
          </button>
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
          No employees match &ldquo;{searchQuery.trim()}&rdquo;.
        </div>
      ) : (
        <ul className="flex flex-col gap-3" role="list" aria-label="Employee list">
          {filteredEmployees.map((emp) => (
            <li key={emp.id}>
              <EmployeeCard
                employee={emp}
                isAdmin={isAdmin}
                isSelf={emp.id === user?.id}
                isRolePending={pendingRoleIds.has(emp.id)}
                isStatusPending={pendingStatusIds.has(emp.id)}
                onPromote={handlePromote}
                onDemote={handleDemote}
                onDeactivate={handleDeactivate}
                onReactivate={handleReactivate}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Invite modal */}
      {inviteModalOpen && (
        <InviteEmployeeModal
          onClose={() => setInviteModalOpen(false)}
        />
      )}

      {/* Role-change confirmation dialog */}
      <EmployeeConfirmDialog
        isOpen={!!roleTarget && !!roleDirection}
        title={roleDialogTitle}
        description={roleDialogDescription}
        confirmLabel={roleDirection === "promote" ? "Promote" : "Demote"}
        pendingLabel={roleDirection === "promote" ? "Promoting..." : "Demoting..."}
        variant="default"
        isPending={changeRoleMutation.isPending}
        onConfirm={handleRoleConfirm}
        onCancel={() => {
          if (!changeRoleMutation.isPending) {
            setRoleTarget(null);
            setRoleDirection(null);
          }
        }}
      />

      {/* Deactivate / Reactivate confirmation dialog */}
      <EmployeeConfirmDialog
        isOpen={!!statusTarget && !!statusAction}
        title={statusDialogTitle}
        description={statusDialogDescription}
        confirmLabel={statusAction === "deactivate" ? "Deactivate" : "Reactivate"}
        pendingLabel={statusAction === "deactivate" ? "Deactivating..." : "Reactivating..."}
        variant={statusAction === "deactivate" ? "destructive" : "default"}
        isPending={isStatusDialogPending}
        onConfirm={handleStatusConfirm}
        onCancel={() => {
          if (!isStatusDialogPending) {
            setStatusTarget(null);
            setStatusAction(null);
          }
        }}
      />
    </div>
  );
}
