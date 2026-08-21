"use client";

/**
 * EmployeesPageContent — client-side content for the /employees route.
 *
 * Orchestrates:
 *   - useEmployees (read — admin-only; FE-4: grace-window polling)
 *   - useChangeEmployeeRole, useDeactivateEmployee, useReactivateEmployee (existing)
 *   - useSoftDeleteEmployee, useHardDeleteEmployee, useUndoScheduledDeletion (PRD 05)
 *   - useCancelInvite, useResendInvite (PRD 05)
 *   - Role-based UI: admin sees management controls; employee sees read-only view
 *   - Loading / error / empty states
 *   - Client-side search/filter by name or email
 *   - Dismissible error banners (Teams pattern)
 *
 * State managed here (UI state — NOT server state):
 *   - inviteModalOpen: boolean
 *   - roleTarget / roleDirection — role-change dialog
 *   - statusTarget / statusAction — deactivate/reactivate dialog
 *   - deletionTarget / deletionAction — soft-delete, hard-delete, undo, cancel-invite, resend-invite
 *   - searchQuery: string
 *   - banner error messages (per action group, dismissible)
 *   - per-employee in-flight Sets (role, status, deletion — concurrent action isolation)
 *
 * Server state lives entirely in TanStack Query. No employee data in Redux.
 *
 * Non-admin employees: shown a read-only directory prompt (no management controls).
 */

import { useState, useMemo } from "react";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { useEmployees } from "../hooks/useEmployees";
import { useChangeEmployeeRole } from "../hooks/useChangeEmployeeRole";
import { useDeactivateEmployee } from "../hooks/useDeactivateEmployee";
import { useReactivateEmployee } from "../hooks/useReactivateEmployee";
import { useSoftDeleteEmployee } from "../hooks/useSoftDeleteEmployee";
import { useHardDeleteEmployee } from "../hooks/useHardDeleteEmployee";
import { useUndoScheduledDeletion } from "../hooks/useUndoScheduledDeletion";
import { useCancelInvite } from "../hooks/useCancelInvite";
import { useResendInvite } from "../hooks/useResendInvite";
import { employeesQueryKeys } from "../hooks/useEmployees";
import { useQueryClient } from "@tanstack/react-query";
import EmployeeCard from "./EmployeeCard";
import InviteEmployeeModal from "./InviteEmployeeModal";
import EmployeeConfirmDialog from "./EmployeeConfirmDialog";
import type { AdminEmployee } from "../types";

// ---------------------------------------------------------------------------
// DismissibleErrorBanner — inline error notification with dismiss button.
// Declared outside the page component so it is not re-created on every render.
// ---------------------------------------------------------------------------

function DismissibleErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
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
  );
}

// ---------------------------------------------------------------------------
// Deletion dialog actions
// ---------------------------------------------------------------------------

type DeletionAction =
  | "schedule-deletion"
  | "delete-now"
  | "cancel-scheduled-deletion"
  | "cancel-invite"
  | "resend-invite";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EmployeesPageContent() {
  const { user } = useCurrentUser();
  const { employees, isLoading, error } = useEmployees();
  const queryClient = useQueryClient();

  // Existing mutations
  const changeRoleMutation = useChangeEmployeeRole();
  const deactivateMutation = useDeactivateEmployee();
  const reactivateMutation = useReactivateEmployee();

  // PRD 05 mutations
  const softDeleteMutation = useSoftDeleteEmployee();
  const hardDeleteMutation = useHardDeleteEmployee();
  const undoScheduledDeletionMutation = useUndoScheduledDeletion();
  const cancelInviteMutation = useCancelInvite();
  const resendInviteMutation = useResendInvite();

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

  // Deletion-family dialog state (soft-delete, hard-delete, undo, cancel-invite, resend-invite).
  const [deletionTarget, setDeletionTarget] = useState<AdminEmployee | null>(null);
  const [deletionAction, setDeletionAction] = useState<DeletionAction | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  // Per-employee in-flight tracking (concurrent action isolation, Teams pattern).
  const [pendingRoleIds, setPendingRoleIds] = useState<Set<string>>(new Set());
  const [pendingStatusIds, setPendingStatusIds] = useState<Set<string>>(new Set());
  const [pendingDeletionIds, setPendingDeletionIds] = useState<Set<string>>(new Set());

  // ---- Quorum check ----
  // Determines whether a "delete self" action is permitted (another active admin exists).
  // Memoized so it doesn't recalculate on every render.
  const hasOtherAdmin = useMemo(() => {
    if (!user) return false;
    return employees.some(
      (emp) =>
        emp.role === "admin" &&
        emp.status !== "deactivated" &&
        emp.id !== user.id
    );
  }, [employees, user]);

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

  // ---- Deletion-family handlers ----

  const openDeletionDialog = (emp: AdminEmployee, action: DeletionAction) => {
    setDeletionError(null);
    setDeletionAction(action);
    setDeletionTarget(emp);
  };

  const handleScheduleDeletion = (emp: AdminEmployee) =>
    openDeletionDialog(emp, "schedule-deletion");

  const handleDeleteNow = (emp: AdminEmployee) =>
    openDeletionDialog(emp, "delete-now");

  const handleCancelScheduledDeletion = (emp: AdminEmployee) =>
    openDeletionDialog(emp, "cancel-scheduled-deletion");

  const handleCancelInvite = (emp: AdminEmployee) =>
    openDeletionDialog(emp, "cancel-invite");

  const handleResendInvite = (emp: AdminEmployee) =>
    openDeletionDialog(emp, "resend-invite");

  const closeDeletionDialog = () => {
    setDeletionTarget(null);
    setDeletionAction(null);
  };

  const handleDeletionConfirm = () => {
    if (!deletionTarget || !deletionAction) return;
    if (pendingDeletionIds.has(deletionTarget.id)) return;
    setDeletionError(null);

    const targetId = deletionTarget.id;
    setPendingDeletionIds((prev) => new Set(prev).add(targetId));

    const clearPending = () => {
      setPendingDeletionIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    };

    if (deletionAction === "schedule-deletion") {
      softDeleteMutation.mutate(targetId, {
        onSuccess: (result) => {
          clearPending();
          if (result.success) {
            closeDeletionDialog();
          } else {
            setDeletionError(result.error.message);
            closeDeletionDialog();
          }
        },
        onError: () => {
          clearPending();
          setDeletionError("Something went wrong. Please try again or contact support.");
          closeDeletionDialog();
        },
      });
      return;
    }

    if (deletionAction === "delete-now") {
      hardDeleteMutation.mutate(targetId, {
        onSuccess: (result) => {
          clearPending();
          if (result.success) {
            closeDeletionDialog();
          } else {
            setDeletionError(result.error.message);
            closeDeletionDialog();
          }
        },
        onError: () => {
          clearPending();
          setDeletionError("Something went wrong. Please try again or contact support.");
          closeDeletionDialog();
        },
      });
      return;
    }

    if (deletionAction === "cancel-scheduled-deletion") {
      undoScheduledDeletionMutation.mutate(targetId, {
        onSuccess: (result) => {
          clearPending();
          closeDeletionDialog();
          if (!result.success) {
            setDeletionError(result.error.message);
            return;
          }
          // Race case: cron already promoted the deletion.
          if (!result.data.cancelled && result.data.reason === "already_deleted") {
            setDeletionError(
              "This account has already been deleted and cannot be restored."
            );
            // List was already invalidated unconditionally by the hook's onSuccess.
          }
          // Happy path: result.data.cancelled === true — no error to show.
        },
        onError: () => {
          clearPending();
          setDeletionError("Something went wrong. Please try again or contact support.");
          closeDeletionDialog();
        },
      });
      return;
    }

    if (deletionAction === "cancel-invite") {
      cancelInviteMutation.mutate(targetId, {
        onSuccess: (result) => {
          clearPending();
          if (result.success) {
            closeDeletionDialog();
          } else {
            setDeletionError(result.error.message);
            // Race: invite may have been accepted — trigger list refetch so
            // the admin sees the employee as active.
            queryClient.invalidateQueries({
              queryKey: employeesQueryKeys.lists(),
            });
            closeDeletionDialog();
          }
        },
        onError: () => {
          clearPending();
          setDeletionError("Something went wrong. Please try again or contact support.");
          closeDeletionDialog();
        },
      });
      return;
    }

    if (deletionAction === "resend-invite") {
      if (!deletionTarget.email) {
        clearPending();
        setDeletionError("No email address found for this invitation.");
        closeDeletionDialog();
        return;
      }
      resendInviteMutation.mutate(
        { targetProfileId: targetId, email: deletionTarget.email },
        {
          onSuccess: (result) => {
            clearPending();
            if (result.success) {
              closeDeletionDialog();
            } else {
              setDeletionError(result.error.message);
              // Race: invite may have been accepted — trigger list refetch.
              queryClient.invalidateQueries({
                queryKey: employeesQueryKeys.lists(),
              });
              closeDeletionDialog();
            }
          },
          onError: () => {
            clearPending();
            setDeletionError("Something went wrong. Please try again or contact support.");
            closeDeletionDialog();
          },
        }
      );
      return;
    }
  };

  // ---- Dialog config ----

  const roleDialogTitle =
    roleDirection === "promote" ? "Promote to Admin" : "Demote to Employee";
  const roleDialogDescription =
    roleDirection === "promote"
      ? `Promote ${roleTarget?.displayName ?? roleTarget?.email ?? "this employee"} to Admin? They will gain full management capabilities, including the ability to invite, promote, and deactivate employees.`
      : `Demote ${roleTarget?.displayName ?? roleTarget?.email ?? "this admin"} to Employee? They will lose all management capabilities. They will need to sign out and back in for this change to take effect.`;

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

  // Deletion-family dialog copy (per PRD 05 UX Spec / handoff).
  type DeletionDialogConfig = {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    pendingLabel: string;
    variant: "default" | "destructive";
    isPending: boolean;
  };

  const deletionDialogConfig = useMemo((): DeletionDialogConfig => {
    const name =
      deletionTarget?.displayName ?? deletionTarget?.email ?? "this employee";
    const email = deletionTarget?.email ?? "";

    switch (deletionAction) {
      case "schedule-deletion":
        return {
          title: "Schedule Deletion",
          description: `This will schedule ${name} (${email}) for permanent deletion in 24 hours. Their access will be revoked immediately. You can cancel the deletion during this 24-hour window.`,
          confirmLabel: "Schedule Deletion",
          cancelLabel: "Cancel",
          pendingLabel: "Scheduling...",
          variant: "destructive",
          isPending: softDeleteMutation.isPending,
        };
      case "delete-now":
        return {
          title: "Permanently Delete Employee",
          description: `This will permanently remove ${name} (${email}) from the system. Their team memberships will be preserved for you to clean up manually. This action cannot be undone.`,
          confirmLabel: "Delete Permanently",
          cancelLabel: "Cancel",
          pendingLabel: "Deleting...",
          variant: "destructive",
          isPending: hardDeleteMutation.isPending,
        };
      case "cancel-scheduled-deletion":
        return {
          title: "Cancel Scheduled Deletion",
          description: `This will cancel the scheduled deletion for ${name} (${email}) and restore their access.`,
          confirmLabel: "Cancel Deletion",
          cancelLabel: "Keep Deletion",
          pendingLabel: "Cancelling...",
          variant: "default",
          isPending: undoScheduledDeletionMutation.isPending,
        };
      case "cancel-invite":
        return {
          title: "Cancel Invitation",
          description: `This will cancel the pending invitation for ${email} and remove their account. They will no longer be able to use the invite link.`,
          confirmLabel: "Cancel Invitation",
          cancelLabel: "Keep Invitation",
          pendingLabel: "Cancelling...",
          variant: "destructive",
          isPending: cancelInviteMutation.isPending,
        };
      case "resend-invite":
        return {
          title: "Resend Invitation",
          description: `This will send a fresh invitation to ${email}. The previous invite link will no longer work.`,
          confirmLabel: "Resend",
          cancelLabel: "Cancel",
          pendingLabel: "Sending...",
          variant: "default",
          isPending: resendInviteMutation.isPending,
        };
      default:
        return {
          title: "",
          description: "",
          confirmLabel: "Confirm",
          cancelLabel: "Cancel",
          pendingLabel: "Processing...",
          variant: "default",
          isPending: false,
        };
    }
  }, [
    deletionAction,
    deletionTarget,
    softDeleteMutation.isPending,
    hardDeleteMutation.isPending,
    undoScheduledDeletionMutation.isPending,
    cancelInviteMutation.isPending,
    resendInviteMutation.isPending,
  ]);

  const isDeletionDialogPending = deletionDialogConfig.isPending;

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

      {/* Error banners */}
      {roleError && (
        <DismissibleErrorBanner message={roleError} onDismiss={() => setRoleError(null)} />
      )}
      {statusError && (
        <DismissibleErrorBanner message={statusError} onDismiss={() => setStatusError(null)} />
      )}
      {deletionError && (
        <DismissibleErrorBanner message={deletionError} onDismiss={() => setDeletionError(null)} />
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
                isStatusPending={
                  pendingStatusIds.has(emp.id) || pendingDeletionIds.has(emp.id)
                }
                hasOtherAdmin={hasOtherAdmin}
                onPromote={handlePromote}
                onDemote={handleDemote}
                onDeactivate={handleDeactivate}
                onReactivate={handleReactivate}
                onScheduleDeletion={handleScheduleDeletion}
                onDeleteNow={handleDeleteNow}
                onCancelScheduledDeletion={handleCancelScheduledDeletion}
                onCancelInvite={handleCancelInvite}
                onResendInvite={handleResendInvite}
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

      {/* Deletion-family confirmation dialog (schedule, hard-delete, undo, cancel-invite, resend) */}
      <EmployeeConfirmDialog
        isOpen={!!deletionTarget && !!deletionAction}
        title={deletionDialogConfig.title}
        description={deletionDialogConfig.description}
        confirmLabel={deletionDialogConfig.confirmLabel}
        cancelLabel={deletionDialogConfig.cancelLabel}
        pendingLabel={deletionDialogConfig.pendingLabel}
        variant={deletionDialogConfig.variant}
        isPending={isDeletionDialogPending}
        onConfirm={handleDeletionConfirm}
        onCancel={() => {
          if (!isDeletionDialogPending) {
            closeDeletionDialog();
          }
        }}
      />
    </div>
  );
}
