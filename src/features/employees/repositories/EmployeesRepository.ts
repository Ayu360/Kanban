/**
 * EmployeesRepository — the repository interface for the employees feature.
 *
 * This is the swap seam (ADR-0004). The service layer depends on this
 * interface, not on SupabaseEmployeesRepository. Swapping the backend means
 * providing a new concrete implementation; nothing above this layer changes.
 *
 * Design rules:
 *   - All methods return domain types (Employee, AdminEmployee, etc.), never Supabase types.
 *   - All methods throw AppError on failure, never PostgrestError or AuthApiError.
 *   - Methods are async. No synchronous reads.
 *   - No Supabase imports in this file.
 *   - Reads route through the two projected views (not the base profiles table).
 *   - Writes route through the four SECURITY DEFINER RPCs (or Auth admin API for invite).
 */

import type {
  Employee,
  AdminEmployee,
  InviteEmployeeResult,
  ChangeRoleResult,
  DeactivateResult,
  ReactivateResult,
  ActivateInvitedResult,
} from "../types";

export interface EmployeesRepository {
  /**
   * Lists all active/pending/deactivated employees for a company (admin view).
   * Reads from `public.admin_employee_list` via service-role client.
   * The view is NOT company-scoped — callerCompanyId is applied as a WHERE filter.
   * Sorted alphabetically by display_name ASC NULLS LAST.
   *
   * Throws AppError on query failure.
   */
  listByCompany(callerCompanyId: string): Promise<AdminEmployee[]>;

  /**
   * Fetches a single employee's full record by profile ID.
   * Reads from `public.admin_employee_list` via service-role client.
   * Returns null if the profile does not exist.
   *
   * Throws AppError on unexpected query failure.
   */
  getById(profileId: string): Promise<AdminEmployee | null>;

  /**
   * Lists active employees for the employee directory (task picker, team picker).
   * Reads from `public.employee_directory` via the authenticated (anon) client.
   * The view handles company scoping and deactivated exclusion internally.
   *
   * Throws AppError on query failure.
   */
  listDirectory(): Promise<Employee[]>;

  /**
   * Checks whether a profile with the given email already exists in a company.
   * Used to detect duplicate invite attempts before calling the Auth admin API.
   * Reads from `public.admin_employee_list` via service-role client.
   *
   * Returns the matching AdminEmployee or null if not found.
   *
   * Throws AppError on query failure.
   */
  findByEmail(email: string, companyId: string): Promise<AdminEmployee | null>;

  /**
   * Invites a new employee via Supabase Auth admin API, then inserts a profiles
   * row with status='pending'. Uses the service-role client.
   *
   * Returns { profileId } of the newly created profile row.
   *
   * Throws AppError with:
   *   - CONFLICT for "email already registered in Supabase Auth"
   *   - UNKNOWN_ERROR for unexpected failures
   */
  invite(email: string, callerCompanyId: string): Promise<InviteEmployeeResult>;

  /**
   * Promotes or demotes a profile's role via the `change_employee_role` RPC.
   * Uses the service-role client (RPC is SECURITY DEFINER, GRANT to service_role).
   *
   * Returns ChangeRoleResult with old_role, new_role, noop.
   *
   * Throws AppError with:
   *   - VALIDATION_ERROR for invalid role value (check_violation)
   *   - FORBIDDEN for permission denied / self-demotion (insufficient_privilege)
   *   - NOT_FOUND for unknown target profile (no_data_found)
   *   - LAST_ADMIN_LOCKOUT for last-admin demotion guard (check_violation + prefix)
   *   - UNKNOWN_ERROR for unexpected failures
   */
  changeRole(
    targetProfileId: string,
    newRole: "admin" | "employee"
  ): Promise<ChangeRoleResult>;

  /**
   * Deactivates a profile via the `deactivate_employee` RPC (DB step only).
   * The Server Action is responsible for the trailing Auth ban step.
   * Uses the service-role client.
   *
   * Throws AppError with:
   *   - FORBIDDEN for permission / self-deactivation (insufficient_privilege)
   *   - NOT_FOUND for unknown target profile (no_data_found)
   *   - LAST_ADMIN_LOCKOUT (check_violation + prefix)
   *   - CANNOT_DEACTIVATE_PENDING (invalid_parameter_value + prefix)
   *   - UNKNOWN_ERROR for unexpected failures
   */
  deactivate(targetProfileId: string): Promise<DeactivateResult>;

  /**
   * Reactivates a profile via the `reactivate_employee` RPC (DB step only).
   * The Server Action is responsible for the trailing Auth unban step.
   * Uses the service-role client.
   *
   * Throws AppError with:
   *   - FORBIDDEN for permission denied (insufficient_privilege)
   *   - NOT_FOUND for unknown target profile (no_data_found)
   *   - VALIDATION_ERROR for pending profile reactivation (invalid_parameter_value)
   *   - UNKNOWN_ERROR for unexpected failures
   */
  reactivate(targetProfileId: string): Promise<ReactivateResult>;

  /**
   * Self-activation RPC for invited users accepting their invitation.
   * Calls `activate_invited_employee()` using the AUTHENTICATED (browser-session)
   * Supabase client — NOT the service-role client.
   *
   * No parameters — the RPC reads auth.uid() internally.
   * Idempotent: already-active returns noop=true.
   *
   * Throws AppError with:
   *   - FORBIDDEN for unauthenticated or deactivated caller (insufficient_privilege)
   *   - NOT_FOUND for missing profile row (no_data_found)
   *   - UNKNOWN_ERROR for unexpected failures
   */
  activateInvited(): Promise<ActivateInvitedResult>;

  /**
   * Bans a user in Supabase Auth (practical permanent ban).
   * Called by the Server Action AFTER the deactivate RPC succeeds.
   * Uses the service-role client's auth.admin API.
   *
   * Returns void on success or throws AppError on failure.
   */
  banUser(targetAuthId: string): Promise<void>;

  /**
   * Unbans a user in Supabase Auth.
   * Called by the Server Action AFTER the reactivate RPC succeeds.
   * Uses the service-role client's auth.admin API.
   *
   * Returns void on success or throws AppError on failure.
   */
  unbanUser(targetAuthId: string): Promise<void>;
}
