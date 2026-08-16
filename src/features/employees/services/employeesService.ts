/**
 * EmployeesService — business logic layer for the employees feature.
 *
 * Orchestrates repository calls, enforces business rules, and is the single
 * place where domain-level authorization decisions are made (which roles can
 * perform which operations, self-modification guards, company scoping).
 *
 * This service is UI-agnostic and testable in isolation by mocking the
 * EmployeesRepository interface.
 *
 * Authorization model (ADR-0008, ADR-0009):
 *   Platform admin (is_platform_admin = true): can manage any employee in any company.
 *   Company admin (role = 'admin'): can manage employees within their own company_id.
 *   Employee (role = 'employee'): read-only directory access via the view.
 *     Server Actions for management are forbidden — service checks return FORBIDDEN.
 *
 * IMPORTANT: is_platform_admin and role are INDEPENDENT (ADR-0008).
 *   A platform admin may have role = 'employee'. The authorization check is:
 *   caller.isPlatformAdmin OR caller.role === 'admin'    (OR, not AND)
 *   Do NOT require both.
 *
 * Service-layer authz is defense-in-depth on top of:
 *   - RLS policies on the views (read path)
 *   - SECURITY DEFINER RPCs (write path — DB is the authoritative enforcement layer)
 *
 * No Supabase types, no table names, no SQL in this file.
 */

import "server-only";

import type { EmployeesRepository } from "../repositories/EmployeesRepository";
import type {
  Employee,
  AdminEmployee,
  InviteEmployeeResult,
  ChangeRoleResult,
  DeactivateResult,
  ReactivateResult,
  ActivateInvitedResult,
} from "../types";
import { AppError } from "../types";
import type { Profile } from "@/features/auth/types";
export { normalizeError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Validation helpers (pure functions, no I/O)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an email address.
 * Returns null on valid input or a user-facing error message string.
 */
export function validateEmail(email: string | undefined | null): string | null {
  if (!email || email.trim().length === 0) return "Email address is required.";
  if (!EMAIL_RE.test(email.trim())) return "Please enter a valid email address.";
  return null;
}

/**
 * Validates a role value.
 * Returns null on valid input or a user-facing error message string.
 */
export function validateRole(role: string | undefined | null): string | null {
  if (role !== "admin" && role !== "employee") {
    return "Role must be 'admin' or 'employee'.";
  }
  return null;
}

/**
 * Basic UUID shape check.
 * Not exhaustive — just a sanity guard before DB round-trips.
 */
export function validateUUID(
  value: string | undefined | null,
  label: string
): string | null {
  if (!value) return `${label} is required.`;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(value)) return `${label} is not a valid identifier.`;
  return null;
}

// ---------------------------------------------------------------------------
// EmployeesService
// ---------------------------------------------------------------------------

export class EmployeesService {
  constructor(private readonly repo: EmployeesRepository) {}

  // -------------------------------------------------------------------------
  // listEmployees (admin view)
  // -------------------------------------------------------------------------
  /**
   * Returns all employees for a company (admin management list).
   * Authorization: platform admin OR company admin.
   *
   * Platform admins can query any company. Company admins are scoped to their
   * own company_id. The service enforces this before the repository call.
   */
  async listEmployees(
    callerCompanyId: string,
    caller: Profile
  ): Promise<AdminEmployee[]> {
    const companyIdError = validateUUID(callerCompanyId, "Company ID");
    if (companyIdError) {
      throw new AppError("VALIDATION_ERROR", companyIdError);
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to view the employee list."
      );
    }

    // Company admin can only view their own company's employees.
    if (!caller.isPlatformAdmin && caller.companyId !== callerCompanyId) {
      throw new AppError(
        "FORBIDDEN",
        "You can only view employees within your own company."
      );
    }

    return this.repo.listByCompany(callerCompanyId);
  }

  // -------------------------------------------------------------------------
  // getEmployee
  // -------------------------------------------------------------------------
  /**
   * Returns a single employee by profile ID (admin view).
   * Authorization: platform admin OR company admin.
   */
  async getEmployee(
    profileId: string,
    caller: Profile
  ): Promise<AdminEmployee | null> {
    const profileIdError = validateUUID(profileId, "Profile ID");
    if (profileIdError) {
      throw new AppError("VALIDATION_ERROR", profileIdError);
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to view employee details."
      );
    }

    const employee = await this.repo.getById(profileId);

    // Company admin company-scope check
    if (
      employee &&
      !caller.isPlatformAdmin &&
      employee.companyId !== caller.companyId
    ) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to view this employee."
      );
    }

    return employee;
  }

  // -------------------------------------------------------------------------
  // listDirectory (employee-facing)
  // -------------------------------------------------------------------------
  /**
   * Returns the employee directory for task/team pickers.
   * Available to ALL authenticated users — the view handles company scoping.
   * No authorization gate needed beyond being authenticated (middleware handles that).
   */
  async listDirectory(): Promise<Employee[]> {
    return this.repo.listDirectory();
  }

  // -------------------------------------------------------------------------
  // inviteEmployee
  // -------------------------------------------------------------------------
  /**
   * Invites a new employee by email.
   * Authorization: platform admin OR company admin.
   *
   * Flow:
   *   1. Validate email format.
   *   2. Check for existing profile with this email in the company (duplicate guard).
   *   3. Call repo.invite() which calls Auth admin API + inserts profiles row.
   *
   * Edge cases:
   *   - Email already exists in this company with any status → CONFLICT with message.
   *   - Email already registered in Supabase Auth (outside company) → CONFLICT.
   */
  async inviteEmployee(
    email: string,
    caller: Profile
  ): Promise<InviteEmployeeResult> {
    const emailError = validateEmail(email);
    if (emailError) {
      throw new AppError("VALIDATION_ERROR", emailError);
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to invite employees."
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Duplicate invite check: look for an existing profile in this company
    // with the given email before hitting the Auth API.
    const existingProfile = await this.repo.findByEmail(
      normalizedEmail,
      caller.companyId
    );

    if (existingProfile) {
      if (existingProfile.status === "pending") {
        throw new AppError(
          "CONFLICT",
          "An invitation has already been sent to this email address."
        );
      }
      // active or deactivated employee already in the company
      throw new AppError(
        "CONFLICT",
        "This email address belongs to an existing employee in your company."
      );
    }

    return this.repo.invite(normalizedEmail, caller.companyId);
  }

  // -------------------------------------------------------------------------
  // changeEmployeeRole
  // -------------------------------------------------------------------------
  /**
   * Promotes or demotes a profile's role.
   * Authorization: platform admin OR company admin.
   *
   * Self-modification guard (ADR-0008):
   *   Company admins cannot change their own role (blocks self-demotion lockout).
   *   Platform admins are EXEMPT from this check (PRD FR-03).
   *
   * Company scope guard:
   *   Company admins can only change roles for employees in their own company.
   *   Platform admins can change roles across companies.
   *
   * Last-admin lockout (demotion path):
   *   When demoting an admin to 'employee', we perform the same service-layer
   *   last-admin check as deactivateEmployee (Option A — full parity).
   *   NOTE: DB guard G5 uses auth.uid() which returns NULL under service-role —
   *   this check does NOT fire at the DB layer. The service check is the
   *   effective enforcement path. Do not remove without changing the RPC call
   *   path to an authenticated-server-client.
   */
  async changeEmployeeRole(
    targetProfileId: string,
    newRole: "admin" | "employee",
    caller: Profile
  ): Promise<ChangeRoleResult> {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      throw new AppError("VALIDATION_ERROR", profileIdError);
    }

    const roleError = validateRole(newRole);
    if (roleError) {
      throw new AppError("VALIDATION_ERROR", roleError);
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to change employee roles."
      );
    }

    // Self-modification guard — platform admins are exempt (PRD FR-03).
    if (!caller.isPlatformAdmin && caller.id === targetProfileId) {
      throw new AppError(
        "FORBIDDEN",
        "You cannot change your own role. Ask another admin to make this change."
      );
    }

    // Fetch the target to enforce company scope and last-admin check.
    // For platform admins demoting cross-company, we still need the target's
    // companyId to scope the last-admin count correctly.
    const target = await this.repo.getById(targetProfileId);
    if (!target) {
      throw new AppError("NOT_FOUND", "Employee profile not found.");
    }

    // Company scope guard for company admins.
    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      throw new AppError(
        "FORBIDDEN",
        "You can only change roles for employees within your own company."
      );
    }

    // Last-admin demotion guard — only relevant when demoting an admin.
    // Platform admins acting cross-company use target.companyId (not caller.companyId).
    if (newRole === "employee" && target.role === "admin") {
      const allInCompany = await this.repo.listByCompany(target.companyId);
      const remainingAdmins = allInCompany.filter(
        (e) =>
          e.role === "admin" &&
          e.status !== "deactivated" &&
          e.id !== targetProfileId
      );
      if (remainingAdmins.length === 0) {
        throw new AppError(
          "FORBIDDEN",
          "Cannot demote the last active admin in this company. Promote another employee to admin first."
        );
      }
    }

    return this.repo.changeRole(targetProfileId, newRole);
  }

  // -------------------------------------------------------------------------
  // deactivateEmployee
  // -------------------------------------------------------------------------
  /**
   * Deactivates a profile (DB step + Auth ban).
   * Authorization: platform admin OR company admin.
   *
   * Self-deactivation guard: blocked for all callers.
   *
   * Two-step process (DB is authority, Auth ban is trailing side effect):
   *   Step 1: repo.deactivate() → deactivate_employee RPC (DB state change)
   *   Step 2: repo.banUser()    → auth.admin.updateUserById (session revocation)
   *
   * If step 2 fails:
   *   - The DB is in the correct deactivated state.
   *   - The user's current session persists until JWT refresh (≤1 hour).
   *   - Middleware will then catch status='deactivated' and redirect.
   *   - We log the inconsistency and surface a partial-success error.
   *   - The caller can retry the Auth ban via a separate remediation action.
   *   - We do NOT automatically roll back (rollback would leave the user active,
   *     which is worse than being deactivated-but-still-sessioned).
   */
  async deactivateEmployee(
    targetProfileId: string,
    caller: Profile
  ): Promise<DeactivateResult> {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      throw new AppError("VALIDATION_ERROR", profileIdError);
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to deactivate employees."
      );
    }

    // Self-deactivation is blocked for ALL callers (including platform admins).
    if (caller.id === targetProfileId) {
      throw new AppError(
        "FORBIDDEN",
        "You cannot deactivate your own account."
      );
    }

    // Fetch the target to enforce company scope and last-admin check.
    // For platform admins acting cross-company, we need target.companyId to
    // scope the last-admin count to the correct company.
    const target = await this.repo.getById(targetProfileId);
    if (!target) {
      throw new AppError("NOT_FOUND", "Employee profile not found.");
    }

    // Company scope guard for company admins.
    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      throw new AppError(
        "FORBIDDEN",
        "You can only deactivate employees within your own company."
      );
    }

    // Last-admin deactivation guard — only relevant when the target is an admin.
    // If the target is a plain employee, this check is irrelevant — skip it.
    //
    // NOTE: DB guard G7 uses auth.uid() which returns NULL under service-role —
    // this check does NOT fire at the DB layer. This service check is the
    // effective enforcement path. Do not remove without changing the RPC call
    // path to an authenticated-server-client.
    //
    // Company scope: always use target.companyId (correct for both company admins
    // and platform admins acting cross-company).
    if (target.role === "admin") {
      const allInCompany = await this.repo.listByCompany(target.companyId);
      const remainingAdmins = allInCompany.filter(
        (e) =>
          e.role === "admin" &&
          e.status !== "deactivated" &&
          e.id !== targetProfileId
      );
      if (remainingAdmins.length === 0) {
        throw new AppError(
          "FORBIDDEN",
          "Cannot deactivate the last active admin in this company. Promote another employee to admin first."
        );
      }
    }

    // Step 1: DB deactivation (authoritative state change). If this fails, stop.
    const result = await this.repo.deactivate(targetProfileId);

    // Noop path: already deactivated — skip the Auth ban.
    if (result.noop) {
      return result;
    }

    // Step 2: Auth ban (trailing side effect for immediate session revocation).
    try {
      await this.repo.banUser(targetProfileId);
    } catch (authBanError) {
      // The DB state is correct (deactivated). The Auth ban failed.
      // Log for ops visibility. The user will be blocked at the next JWT
      // refresh (≤1 hour) via middleware reading status='deactivated'.
      // We surface this as an UNKNOWN_ERROR so the admin knows to retry.
      console.error(
        "[EmployeesService.deactivateEmployee] Auth ban failed after successful DB deactivation. " +
          `targetProfileId: ${targetProfileId}. The profile is deactivated in the DB ` +
          "but the user's current session may persist until JWT refresh.",
        authBanError
      );

      throw new AppError(
        "UNKNOWN_ERROR",
        "The employee was deactivated but their current session could not be revoked immediately. " +
          "They will be blocked automatically within one hour. Contact support if immediate revocation is required.",
        authBanError
      );
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // reactivateEmployee
  // -------------------------------------------------------------------------
  /**
   * Reactivates a deactivated profile (DB step + Auth unban).
   * Authorization: platform admin OR company admin.
   *
   * Two-step process (DB is authority, Auth unban is trailing side effect):
   *   Step 1: repo.reactivate() → reactivate_employee RPC (DB state change)
   *   Step 2: repo.unbanUser()  → auth.admin.updateUserById (session restoration)
   *
   * If step 2 fails (compensating action):
   *   - The DB shows the profile as active, but Auth still blocks login.
   *   - We call repo.deactivate() to roll back the DB to deactivated state.
   *   - Then surface the error so the admin can retry the full flow.
   */
  async reactivateEmployee(
    targetProfileId: string,
    caller: Profile
  ): Promise<ReactivateResult> {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      throw new AppError("VALIDATION_ERROR", profileIdError);
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to reactivate employees."
      );
    }

    // Company scope guard for company admins.
    if (!caller.isPlatformAdmin) {
      const target = await this.repo.getById(targetProfileId);
      if (!target) {
        throw new AppError("NOT_FOUND", "Employee profile not found.");
      }
      if (target.companyId !== caller.companyId) {
        throw new AppError(
          "FORBIDDEN",
          "You can only reactivate employees within your own company."
        );
      }
    }

    // Step 1: DB reactivation (authoritative state change). If this fails, stop.
    const result = await this.repo.reactivate(targetProfileId);

    // Noop path: already active — skip the Auth unban.
    if (result.noop) {
      return result;
    }

    // Step 2: Auth unban (trailing side effect to restore login access).
    try {
      await this.repo.unbanUser(targetProfileId);
    } catch (authUnbanError) {
      // Auth unban failed: DB says active, but Auth still blocks login.
      // Compensating action: roll back the DB to deactivated.
      console.error(
        "[EmployeesService.reactivateEmployee] Auth unban failed after successful DB reactivation. " +
          `targetProfileId: ${targetProfileId}. Attempting DB rollback.`,
        authUnbanError
      );

      try {
        await this.repo.deactivate(targetProfileId);
        console.info(
          "[EmployeesService.reactivateEmployee] DB rollback succeeded. " +
            `Profile ${targetProfileId} returned to deactivated state.`
        );
      } catch (rollbackError) {
        // Rollback also failed — the system is in an inconsistent state.
        // DB shows active, Auth blocks login. Needs manual remediation.
        console.error(
          "[EmployeesService.reactivateEmployee] DB rollback ALSO FAILED. " +
            `Profile ${targetProfileId} is in an inconsistent state: ` +
            "DB shows 'active' but Auth blocks login. Manual intervention required.",
          rollbackError
        );
      }

      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to restore the employee's login access. The operation has been rolled back. Please try again.",
        authUnbanError
      );
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // activateInvitedEmployee
  // -------------------------------------------------------------------------
  /**
   * Self-activation for invited users accepting their invitation.
   * Called from the invite-acceptance callback with the invited user's session.
   *
   * No caller Profile needed — the RPC uses auth.uid() internally.
   * No authz gate needed — the RPC only allows self-activation (no spoofing).
   */
  async activateInvitedEmployee(): Promise<ActivateInvitedResult> {
    return this.repo.activateInvited();
  }
}
