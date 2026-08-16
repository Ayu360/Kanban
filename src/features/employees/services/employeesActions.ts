"use server";

/**
 * Employees Server Actions — privileged employee management operations.
 *
 * Marked 'use server' — these run only on the server. The service-role key
 * (used by admin RPCs, Auth admin API, and view reads) never leaves the
 * server boundary.
 *
 * ADR-0015: Employee invitation, role changes, and deactivation/reactivation
 * are privileged operations that must be Server Actions. Directory reads are
 * not Server Actions — they are browser-client queries via TanStack Query hooks.
 *
 * Error contract:
 *   All actions return ActionResult<T> — a discriminated union.
 *   They NEVER throw. Callers switch on result.success to handle errors.
 *   This keeps error handling in the UI layer explicit and type-safe.
 *
 * Security contract:
 *   - Caller identity is ALWAYS derived from the authenticated session
 *     (via authService.getCurrentProfile()). It is NEVER accepted from the client.
 *   - getCallerProfile() is called INSIDE each try block (Teams pattern).
 *     Do NOT hoist it outside — this ensures it is re-evaluated per-action
 *     and avoids stale caller state if the session changes between calls.
 *   - No p_caller_id params are passed to any RPC — identity comes from
 *     auth.uid() in SECURITY DEFINER RPCs. For service-role calls where
 *     auth.uid() is unavailable, the service layer is the authorization gate.
 *
 * Composition root:
 *   Actions import from container.ts to get EmployeesService.
 *   They do not instantiate repositories or clients directly.
 */

import type {
  ActionResult,
  InviteEmployeeResult,
  ChangeRoleResult,
  DeactivateResult,
  ReactivateResult,
  ActivateInvitedResult,
  AdminEmployee,
  Employee,
} from "../types";
import { normalizeError } from "./employeesService";
import { getEmployeesService, getAuthService } from "@/lib/container";

// ---------------------------------------------------------------------------
// Private helper: get the authenticated caller's profile
// ---------------------------------------------------------------------------

/**
 * Loads the current caller's profile from the server session.
 * Returns null if there is no authenticated session.
 *
 * Called INSIDE each action's try block (Teams pattern — do not hoist).
 */
async function getCallerProfile() {
  const authService = getAuthService();
  return authService.getCurrentProfile();
}

// ---------------------------------------------------------------------------
// listEmployeesAction — admin employee list
// ---------------------------------------------------------------------------

/**
 * Returns the full employee list (admin view) for the caller's company.
 * Authorization: platform admin OR company admin.
 *
 * Reads from `public.admin_employee_list` via service-role client (view includes
 * email and status — not accessible to plain employees).
 */
export async function listEmployeesAction(
  companyId: string
): Promise<ActionResult<AdminEmployee[]>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to view the employee list.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const employees = await employeesService.listEmployees(companyId, caller);
    return { success: true, data: employees };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// getEmployeeAction — single employee (admin view)
// ---------------------------------------------------------------------------

/**
 * Returns a single employee's full record by profile ID.
 * Authorization: platform admin OR company admin.
 */
export async function getEmployeeAction(
  profileId: string
): Promise<ActionResult<AdminEmployee | null>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to view employee details.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const employee = await employeesService.getEmployee(profileId, caller);
    return { success: true, data: employee };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// listEmployeeDirectoryAction — directory (all authenticated users)
// ---------------------------------------------------------------------------

/**
 * Returns the employee directory for task/team member pickers.
 * Available to ALL authenticated users (directory view handles access control).
 *
 * Reads from `public.employee_directory` which excludes deactivated employees
 * and is scoped to the caller's company via JWT claim.
 */
export async function listEmployeeDirectoryAction(): Promise<
  ActionResult<Employee[]>
> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to view the employee directory.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const directory = await employeesService.listDirectory();
    return { success: true, data: directory };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// inviteEmployeeAction
// ---------------------------------------------------------------------------

/**
 * Invites a new employee by email address.
 * Authorization: platform admin OR company admin.
 *
 * Flow:
 *   1. Validate email format.
 *   2. Check for duplicate in company (service layer).
 *   3. Call Auth admin inviteUserByEmail → creates auth user + sends email.
 *   4. Insert profiles row with status='pending'.
 *   5. Return { profileId }.
 *
 * Handles "email already registered" case gracefully — returns CONFLICT with
 * a user-facing message rather than leaking Auth internals.
 */
export async function inviteEmployeeAction(input: {
  email: string;
}): Promise<ActionResult<InviteEmployeeResult>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to invite employees.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const result = await employeesService.inviteEmployee(input.email, caller);
    return { success: true, data: result };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// changeEmployeeRoleAction
// ---------------------------------------------------------------------------

/**
 * Promotes or demotes an employee's role between 'admin' and 'employee'.
 * Authorization: platform admin OR company admin.
 *
 * Self-demotion is blocked for company admins (not platform admins — PRD FR-03).
 * Last-admin lockout is enforced at the DB layer.
 *
 * No Auth API call needed — role changes do not affect Supabase Auth session state.
 */
export async function changeEmployeeRoleAction(input: {
  targetProfileId: string;
  newRole: "admin" | "employee";
}): Promise<ActionResult<ChangeRoleResult>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to change employee roles.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const result = await employeesService.changeEmployeeRole(
      input.targetProfileId,
      input.newRole,
      caller
    );
    return { success: true, data: result };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// deactivateEmployeeAction
// ---------------------------------------------------------------------------

/**
 * Deactivates an employee (DB first, then Auth ban — M-2 ordering).
 * Authorization: platform admin OR company admin.
 *
 * Two-step:
 *   Step 1: DB deactivation RPC (deactivate_employee).
 *   Step 2: Auth ban (auth.admin.updateUserById ban_duration='876000h').
 *
 * If step 2 fails, the service surfaces a partial-success error.
 * The admin is informed that the user will be blocked at next JWT refresh.
 * No automatic rollback — deactivated-in-DB is the correct persistent state.
 */
export async function deactivateEmployeeAction(input: {
  targetProfileId: string;
}): Promise<ActionResult<DeactivateResult>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to deactivate employees.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const result = await employeesService.deactivateEmployee(
      input.targetProfileId,
      caller
    );
    return { success: true, data: result };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// reactivateEmployeeAction
// ---------------------------------------------------------------------------

/**
 * Reactivates a previously deactivated employee (DB first, then Auth unban).
 * Authorization: platform admin OR company admin.
 *
 * Two-step:
 *   Step 1: DB reactivation RPC (reactivate_employee).
 *   Step 2: Auth unban (auth.admin.updateUserById ban_duration='none').
 *
 * If step 2 fails, compensating action: roll back the DB to deactivated state,
 * then surface the error so the admin can retry the full flow.
 */
export async function reactivateEmployeeAction(input: {
  targetProfileId: string;
}): Promise<ActionResult<ReactivateResult>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to reactivate employees.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const result = await employeesService.reactivateEmployee(
      input.targetProfileId,
      caller
    );
    return { success: true, data: result };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// activateInvitedEmployeeAction
// ---------------------------------------------------------------------------

/**
 * Self-activation for invited employees accepting their invitation.
 * Called from the invite-acceptance callback page with the invited user's session.
 *
 * Uses the authenticated (browser-session) client — NOT service-role.
 * The `activate_invited_employee` RPC reads auth.uid() to identify the caller.
 *
 * Idempotent: already-active is a safe no-op (safe for duplicate callback fires).
 */
export async function activateInvitedEmployeeAction(): Promise<
  ActionResult<ActivateInvitedResult>
> {
  try {
    // Verify the caller is authenticated (basic session check).
    // The RPC will also enforce this internally, but a quick service-layer
    // check surfaces a clearer error message for unauthenticated callers.
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to activate your account.",
        },
      };
    }

    const employeesService = getEmployeesService();
    const result = await employeesService.activateInvitedEmployee();
    return { success: true, data: result };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}
