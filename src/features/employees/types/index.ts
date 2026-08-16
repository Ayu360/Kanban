/**
 * Domain DTOs for the employees feature.
 *
 * These types cross the repository boundary and are the canonical shape that
 * services, hooks, and components consume. No Supabase-specific types appear
 * here — the repository layer normalizes them before returning (ADR-0004).
 *
 * AppError, AppErrorCode, and ActionResult are imported from the shared auth
 * types module (the established cross-feature taxonomy). They are re-exported
 * here so employees-feature consumers have a single import point.
 */

// Re-export shared error/result types from auth (the established taxonomy).
export type { AppErrorCode, ActionResult } from "@/features/auth/types";
export { AppError } from "@/features/auth/types";

// ---------------------------------------------------------------------------
// EmployeeStatus
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a profile in the employees module.
 *   active      — normal, signed-in user
 *   pending     — invited, not yet accepted
 *   deactivated — admin-deactivated, cannot log in
 */
export type EmployeeStatus = "active" | "pending" | "deactivated";

// ---------------------------------------------------------------------------
// Employee (directory shape — minimal, safe for plain employee reads)
// ---------------------------------------------------------------------------

/**
 * The minimal shape exposed to all authenticated users via the
 * `public.employee_directory` view.
 *
 * Intentionally excludes: status, is_platform_admin, email, deactivated_at.
 * Those columns are privileged and only appear in AdminEmployee.
 */
export interface Employee {
  id: string;
  displayName: string | null;
  role: string;
}

// ---------------------------------------------------------------------------
// AdminEmployee (full shape — admin-only, sourced from admin_employee_list view)
// ---------------------------------------------------------------------------

/**
 * The full employee record including privileged fields.
 * Only returned by admin-gated Server Actions via the `admin_employee_list`
 * view (service-role only). Never returned to plain employees.
 *
 * `email` comes from the view's JOIN on auth.users.
 * `displayName` may be null for pending (never-accepted) invitees — fall back
 * to `email` in the UI for display purposes.
 */
export interface AdminEmployee {
  id: string;
  companyId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: EmployeeStatus;
  deactivatedAt: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface InviteEmployeeInput {
  email: string;
}

export interface ChangeEmployeeRoleInput {
  targetProfileId: string;
  newRole: "admin" | "employee";
}

export interface DeactivateEmployeeInput {
  targetProfileId: string;
}

export interface ReactivateEmployeeInput {
  targetProfileId: string;
}

// ---------------------------------------------------------------------------
// Action result data shapes
// ---------------------------------------------------------------------------

export interface InviteEmployeeResult {
  profileId: string;
}

export interface ChangeRoleResult {
  oldRole: string;
  newRole: string;
  noop: boolean;
}

export interface DeactivateResult {
  previousStatus: string;
  status: EmployeeStatus;
  noop: boolean;
}

export interface ReactivateResult {
  previousStatus: string;
  status: EmployeeStatus;
  noop: boolean;
}

export interface ActivateInvitedResult {
  previousStatus: string | undefined;
  status: EmployeeStatus;
  noop: boolean;
}
