"use client";

/**
 * EmployeeCard — a single row in the admin employee management list.
 *
 * Renders:
 *   - Display name (falling back to email for pending employees where displayName = null)
 *   - Email address
 *   - Role badge: Admin / Employee
 *   - Status badge: Active / Pending / Deactivated
 *   - Action buttons (visibility rules per PRD FR-03, FR-04, UI Requirements):
 *       Promote to Admin   — target.role === 'employee' && target.status === 'active' && !isSelf
 *       Demote to Employee — target.role === 'admin'    && target.status === 'active' && !isSelf
 *       Deactivate         — target.status === 'active'   && !isSelf
 *       Reactivate         — target.status === 'deactivated'
 *       (pending rows: no role or status controls — only reactivate is excluded too)
 *
 * Admin controls are UX-only gates. Backend validates authoritatively.
 *
 * Props:
 *   employee    — AdminEmployee record
 *   isAdmin     — whether the caller is admin/platform-admin
 *   isSelf      — whether this row is the caller's own row
 *   isRolePending  — whether a role mutation is in flight for this row
 *   isStatusPending — whether a deactivate/reactivate mutation is in flight
 *   onPromote   — open role-change dialog (→ admin)
 *   onDemote    — open role-change dialog (→ employee)
 *   onDeactivate — open deactivation dialog
 *   onReactivate — open reactivation dialog
 */

import type { AdminEmployee } from "../types";

interface EmployeeCardProps {
  employee: AdminEmployee;
  isAdmin: boolean;
  isSelf: boolean;
  isRolePending: boolean;
  isStatusPending: boolean;
  onPromote: (employee: AdminEmployee) => void;
  onDemote: (employee: AdminEmployee) => void;
  onDeactivate: (employee: AdminEmployee) => void;
  onReactivate: (employee: AdminEmployee) => void;
}

/** Small badge component — keeps markup local. */
function Badge({
  label,
  variant,
}: {
  label: string;
  variant: "admin" | "employee" | "active" | "pending" | "deactivated";
}) {
  const classes: Record<typeof variant, string> = {
    admin:
      "inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    employee:
      "inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    active:
      "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    pending:
      "inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    deactivated:
      "inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400",
  };
  return <span className={classes[variant]}>{label}</span>;
}

export default function EmployeeCard({
  employee,
  isAdmin,
  isSelf,
  isRolePending,
  isStatusPending,
  onPromote,
  onDemote,
  onDeactivate,
  onReactivate,
}: EmployeeCardProps) {
  const displayLabel = employee.displayName ?? employee.email ?? "Unknown";
  const isDeactivated = employee.status === "deactivated";
  const isPending = employee.status === "pending";
  const isActive = employee.status === "active";

  // Determine which action buttons to show.
  const canPromote = isAdmin && !isSelf && isActive && employee.role === "employee";
  const canDemote = isAdmin && !isSelf && isActive && employee.role === "admin";
  const canDeactivate = isAdmin && !isSelf && isActive;
  const canReactivate = isAdmin && isDeactivated;
  // Pending rows: no role or deactivation controls (PRD UI requirements).
  const showAnyAction = canPromote || canDemote || canDeactivate || canReactivate;

  return (
    <div
      className={[
        "flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-800",
        isDeactivated ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Left: identity */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={[
              "truncate text-sm font-semibold",
              isDeactivated
                ? "text-slate-400 dark:text-slate-500"
                : "text-slate-900 dark:text-slate-100",
            ].join(" ")}
          >
            {displayLabel}
            {isSelf && (
              <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                (you)
              </span>
            )}
          </span>
          <Badge
            label={employee.role === "admin" ? "Admin" : "Employee"}
            variant={employee.role === "admin" ? "admin" : "employee"}
          />
          <Badge
            label={
              isPending ? "Pending" : isDeactivated ? "Deactivated" : "Active"
            }
            variant={isPending ? "pending" : isDeactivated ? "deactivated" : "active"}
          />
        </div>
        {employee.email && employee.displayName && (
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {employee.email}
          </p>
        )}
        {isPending && !employee.displayName && (
          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
            Invitation pending — awaiting acceptance
          </p>
        )}
      </div>

      {/* Right: actions */}
      {showAnyAction && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Role change buttons */}
          {canPromote && (
            <button
              type="button"
              onClick={() => onPromote(employee)}
              disabled={isRolePending || isStatusPending}
              aria-label={`Promote ${displayLabel} to admin`}
              className="flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20"
            >
              {isRolePending ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-violet-700"
                  aria-hidden
                />
              ) : null}
              Promote to Admin
            </button>
          )}
          {canDemote && (
            <button
              type="button"
              onClick={() => onDemote(employee)}
              disabled={isRolePending || isStatusPending}
              aria-label={`Demote ${displayLabel} to employee`}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              {isRolePending ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
                  aria-hidden
                />
              ) : null}
              Demote to Employee
            </button>
          )}

          {/* Status change buttons */}
          {canDeactivate && (
            <button
              type="button"
              onClick={() => onDeactivate(employee)}
              disabled={isRolePending || isStatusPending}
              aria-label={`Deactivate ${displayLabel}`}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {isStatusPending ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-red-300 border-t-red-600"
                  aria-hidden
                />
              ) : null}
              Deactivate
            </button>
          )}
          {canReactivate && (
            <button
              type="button"
              onClick={() => onReactivate(employee)}
              disabled={isRolePending || isStatusPending}
              aria-label={`Reactivate ${displayLabel}`}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
            >
              {isStatusPending ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700"
                  aria-hidden
                />
              ) : null}
              Reactivate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
