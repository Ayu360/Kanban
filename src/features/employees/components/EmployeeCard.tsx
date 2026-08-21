"use client";

/**
 * EmployeeCard — a single row in the admin employee management list.
 *
 * Renders:
 *   - Display name (falling back to email for pending employees where displayName = null)
 *   - Email address
 *   - Role badge: Admin / Employee
 *   - Status badge: Active / Pending / Deactivated / Deletion Scheduled (PRD 05)
 *   - Action buttons, gated by employee status and quorum rules:
 *
 *   Active employees (status='active', deletionScheduledAt=null):
 *       Promote to Admin   — role=employee && !isSelf
 *       Demote to Employee — role=admin    && !isSelf
 *       Deactivate         — !isSelf
 *       Schedule Deletion  — !isSelf && !isPlatformAdmin && hasOtherAdmin (if self)
 *       Delete Now         — !isSelf && !isPlatformAdmin && hasOtherAdmin (if self)
 *
 *   Pending employees (status='pending'):
 *       Cancel Invite   — always (for admins)
 *       Resend Invite   — always (for admins)
 *       (no role or status controls)
 *
 *   Grace-window employees (deletionScheduledAt !== null):
 *       Cancel Scheduled Deletion — always (for admins)
 *       (all other actions hidden)
 *
 *   Deactivated employees:
 *       Reactivate — always (for admins)
 *
 * Platform admin rows: delete options absent entirely.
 * Admin's own row: delete + schedule-deletion hidden unless another active
 *   admin exists (hasOtherAdmin prop — quorum check done in the parent).
 *
 * Admin controls are UX-only gates. Backend validates authoritatively.
 */

import type { AdminEmployee } from "../types";

interface EmployeeCardProps {
  employee: AdminEmployee;
  isAdmin: boolean;
  isSelf: boolean;
  isRolePending: boolean;
  isStatusPending: boolean;
  /** Whether another active admin exists in the company (quorum check). */
  hasOtherAdmin: boolean;
  onPromote: (employee: AdminEmployee) => void;
  onDemote: (employee: AdminEmployee) => void;
  onDeactivate: (employee: AdminEmployee) => void;
  onReactivate: (employee: AdminEmployee) => void;
  onScheduleDeletion: (employee: AdminEmployee) => void;
  onDeleteNow: (employee: AdminEmployee) => void;
  onCancelScheduledDeletion: (employee: AdminEmployee) => void;
  onCancelInvite: (employee: AdminEmployee) => void;
  onResendInvite: (employee: AdminEmployee) => void;
}

type BadgeVariant =
  | "admin"
  | "employee"
  | "active"
  | "pending"
  | "deactivated"
  | "deletion-scheduled";

/** Small badge component — keeps markup local. */
function Badge({
  label,
  variant,
  title,
}: {
  label: string;
  variant: BadgeVariant;
  title?: string;
}) {
  const classes: Record<BadgeVariant, string> = {
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
    "deletion-scheduled":
      "inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  };
  return (
    <span className={classes[variant]} title={title}>
      {label}
    </span>
  );
}

/**
 * Formats a UTC ISO 8601 deletion timestamp for display in the badge tooltip.
 * Uses the browser's local timezone (consistent with native Date formatting).
 * Example output: "Scheduled for Aug 21, 2026 at 12:00 PM"
 */
function formatDeletionTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const formatted = date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `Scheduled for ${formatted}`;
  } catch {
    return "Scheduled for deletion";
  }
}

/** Small destructive action button. */
function DestructiveButton({
  label,
  ariaLabel,
  isPending,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  isPending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
    >
      {isPending && (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-red-300 border-t-red-600"
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

/** Small default action button. */
function DefaultButton({
  label,
  ariaLabel,
  isPending,
  onClick,
  colorClass,
}: {
  label: string;
  ariaLabel: string;
  isPending: boolean;
  onClick: () => void;
  colorClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-label={ariaLabel}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${colorClass}`}
    >
      {isPending && (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

export default function EmployeeCard({
  employee,
  isAdmin,
  isSelf,
  isRolePending,
  isStatusPending,
  hasOtherAdmin,
  onPromote,
  onDemote,
  onDeactivate,
  onReactivate,
  onScheduleDeletion,
  onDeleteNow,
  onCancelScheduledDeletion,
  onCancelInvite,
  onResendInvite,
}: EmployeeCardProps) {
  const displayLabel = employee.displayName ?? employee.email ?? "Unknown";
  const isDeactivated = employee.status === "deactivated";
  const isPending = employee.status === "pending";
  const isActive = employee.status === "active";
  const isInGraceWindow = employee.deletionScheduledAt !== null;

  // ----- Status badge derivation -----
  // Deletion Scheduled takes precedence over Active (handoff spec).
  // An employee in the grace window has status='active' but we show the
  // "Deletion Scheduled" badge instead.
  const statusBadgeVariant: BadgeVariant = (() => {
    if (isInGraceWindow) return "deletion-scheduled";
    if (isPending) return "pending";
    if (isDeactivated) return "deactivated";
    return "active";
  })();

  const statusBadgeLabel = (() => {
    if (isInGraceWindow) return "Deletion Scheduled";
    if (isPending) return "Pending";
    if (isDeactivated) return "Deactivated";
    return "Active";
  })();

  const deletionTooltip =
    isInGraceWindow && employee.deletionScheduledAt
      ? formatDeletionTimestamp(employee.deletionScheduledAt)
      : undefined;

  // ----- Action visibility -----
  // For active non-grace-window employees:
  const canPromote =
    isAdmin && !isSelf && isActive && !isInGraceWindow && employee.role === "employee";
  const canDemote =
    isAdmin && !isSelf && isActive && !isInGraceWindow && employee.role === "admin";
  const canDeactivate = isAdmin && !isSelf && isActive && !isInGraceWindow;

  // Delete options are hidden for:
  //   - platform admin targets (never deletable)
  //   - the admin's own row when no other admin exists (last-admin quorum)
  const deletionAllowed =
    isAdmin &&
    !employee.isPlatformAdmin &&
    (!isSelf || hasOtherAdmin);

  const canScheduleDeletion = deletionAllowed && isActive && !isInGraceWindow;
  const canDeleteNow = deletionAllowed && isActive && !isInGraceWindow;

  // Grace-window employees: only one available action.
  const canCancelScheduledDeletion = isAdmin && isInGraceWindow;

  // Pending employees: only invite management.
  const canCancelInvite = isAdmin && isPending;
  const canResendInvite = isAdmin && isPending;

  // Deactivated employees: only reactivate.
  const canReactivate = isAdmin && isDeactivated;

  const showAnyAction =
    canPromote ||
    canDemote ||
    canDeactivate ||
    canScheduleDeletion ||
    canDeleteNow ||
    canCancelScheduledDeletion ||
    canCancelInvite ||
    canResendInvite ||
    canReactivate;

  // Opacity dim: deactivated or in grace window.
  const isDimmed = isDeactivated || isInGraceWindow;

  return (
    <div
      className={[
        "flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-800",
        isDimmed ? "opacity-60" : "",
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
              isDimmed
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
            label={statusBadgeLabel}
            variant={statusBadgeVariant}
            title={deletionTooltip}
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
        {isInGraceWindow && deletionTooltip && (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
            {deletionTooltip}
          </p>
        )}
      </div>

      {/* Right: actions */}
      {showAnyAction && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Grace-window actions (exclusive) */}
          {canCancelScheduledDeletion && (
            <DefaultButton
              label="Cancel Scheduled Deletion"
              ariaLabel={`Cancel scheduled deletion for ${displayLabel}`}
              isPending={isStatusPending}
              onClick={() => onCancelScheduledDeletion(employee)}
              colorClass="border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            />
          )}

          {/* Pending invite actions (exclusive) */}
          {canCancelInvite && (
            <DestructiveButton
              label="Cancel Invite"
              ariaLabel={`Cancel invitation for ${displayLabel}`}
              isPending={isStatusPending}
              onClick={() => onCancelInvite(employee)}
            />
          )}
          {canResendInvite && (
            <DefaultButton
              label="Resend Invite"
              ariaLabel={`Resend invitation to ${displayLabel}`}
              isPending={isStatusPending}
              onClick={() => onResendInvite(employee)}
              colorClass="border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/20"
            />
          )}

          {/* Active employee — role change */}
          {canPromote && (
            <button
              type="button"
              onClick={() => onPromote(employee)}
              disabled={isRolePending || isStatusPending}
              aria-label={`Promote ${displayLabel} to admin`}
              className="flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20"
            >
              {isRolePending && (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-violet-700"
                  aria-hidden
                />
              )}
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
              {isRolePending && (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
                  aria-hidden
                />
              )}
              Demote to Employee
            </button>
          )}

          {/* Active employee — status change */}
          {canDeactivate && (
            <DestructiveButton
              label="Deactivate"
              ariaLabel={`Deactivate ${displayLabel}`}
              isPending={isRolePending || isStatusPending}
              onClick={() => onDeactivate(employee)}
            />
          )}
          {canReactivate && (
            <DefaultButton
              label="Reactivate"
              ariaLabel={`Reactivate ${displayLabel}`}
              isPending={isStatusPending}
              onClick={() => onReactivate(employee)}
              colorClass="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
            />
          )}

          {/* Active employee — deletion actions */}
          {canScheduleDeletion && (
            <DestructiveButton
              label="Schedule Deletion"
              ariaLabel={`Schedule deletion for ${displayLabel}`}
              isPending={isRolePending || isStatusPending}
              onClick={() => onScheduleDeletion(employee)}
            />
          )}
          {canDeleteNow && (
            <DestructiveButton
              label="Delete Now"
              ariaLabel={`Permanently delete ${displayLabel}`}
              isPending={isRolePending || isStatusPending}
              onClick={() => onDeleteNow(employee)}
            />
          )}
        </div>
      )}
    </div>
  );
}
