"use server";

/**
 * employeesLifecycleActions — new lifecycle Server Actions for PRD 05.
 *
 * Implements soft-delete, hard-delete, cancel-scheduled-deletion,
 * cancel-invite, and resend-invite as Server Actions.
 *
 * Security contract (same as employeesActions.ts):
 *   - Caller identity is ALWAYS derived from the authenticated session.
 *     It is NEVER accepted from the client.
 *   - ALL authorization is enforced here in the Server Action. The RPCs'
 *     internal guards use auth.uid() / auth.jwt(), which return NULL under
 *     the service-role invocation path. The Server Action is the SOLE
 *     authorization gate (defense-in-depth noted per reviewer SF-1).
 *   - getCallerProfile() is called INSIDE each try block.
 *
 * Sequencing contracts (from handoff doc):
 *   softDeleteEmployeeAction:   RPC → banUser
 *   hardDeleteEmployeeAction:   banUser → RPC → deleteUser
 *   undoScheduledDeletionAction: RPC → unbanUser (only on success)
 *   cancelInviteAction:         RPC → deleteUser (silent on auth failure per OQ-3)
 *   resendInviteAction:         status check → inviteUserByEmail → log
 *
 * Error contract:
 *   All actions return ActionResult<T>. They NEVER throw.
 *   Error codes follow the project's existing taxonomy (AppErrorCode).
 *   The additional lifecycle error codes are surfaced via FORBIDDEN / NOT_FOUND /
 *   VALIDATION_ERROR / UNKNOWN_ERROR — the specific RPC message prefix is mapped
 *   inside the repository's mapPostgrestError (or directly here for cases
 *   where we call the Auth API directly without going through the repo).
 */

import type {
  ActionResult,
  SoftDeleteResult,
  HardDeleteResult,
  UndoScheduledDeletionResult,
  CancelInviteResult,
  ResendInviteResult,
} from "../types";
import { AppError } from "../types";
import { normalizeError, validateEmail, validateUUID } from "./employeesService";
import { getEmployeesService, getAuthService } from "@/lib/container";
import {
  writeLifecycleLog,
  LogWriteError,
} from "./employeesLifecycleLog";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/env.server";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function getCallerProfile() {
  const authService = getAuthService();
  return authService.getCurrentProfile();
}

/**
 * Maps PostgreSQL / PostgREST error messages from the lifecycle RPCs
 * into AppError instances with user-facing messages.
 *
 * These message prefixes are defined by the SECURITY DEFINER RPCs in
 * 20260819000002 and documented in the database-to-backend handoff.
 * They MUST NOT be changed without a matching DB migration.
 */
function mapLifecycleRpcError(
  error: { code?: string; message?: string },
  context: string
): AppError {
  const message = error.message ?? "";
  const lower = message.toLowerCase();

  if (lower.startsWith("permission_denied:")) {
    return new AppError(
      "FORBIDDEN",
      "You do not have permission to perform this action.",
      error
    );
  }

  if (lower.startsWith("cross_company_denied:")) {
    return new AppError(
      "FORBIDDEN",
      "You cannot perform this action on an employee in a different company.",
      error
    );
  }

  if (lower.startsWith("last_admin_lockout:")) {
    return new AppError(
      "FORBIDDEN",
      "You must promote another admin before deleting your own account.",
      error
    );
  }

  if (lower.startsWith("platform_admin_protected:")) {
    return new AppError(
      "FORBIDDEN",
      "Platform admin accounts cannot be deleted.",
      error
    );
  }

  if (lower.startsWith("cannot_delete_pending:")) {
    return new AppError(
      "VALIDATION_ERROR",
      "This invitation must be cancelled, not deleted. Use 'Cancel Invite' instead.",
      error
    );
  }

  if (lower.startsWith("invalid_state_for_soft_delete:")) {
    return new AppError(
      "VALIDATION_ERROR",
      "Only active employees can be scheduled for deletion.",
      error
    );
  }

  if (lower.startsWith("not_pending:")) {
    return new AppError(
      "VALIDATION_ERROR",
      "This invitation has already been accepted. Refresh the page and manage the employee from the active employees list.",
      error
    );
  }

  if (lower.startsWith("target_not_found:") || error.code === "P0002") {
    return new AppError(
      "NOT_FOUND",
      "Employee not found. The page may be out of date — please refresh.",
      error
    );
  }

  return new AppError(
    "UNKNOWN_ERROR",
    `Something went wrong in ${context}. Please try again or contact support.`,
    error
  );
}

// ---------------------------------------------------------------------------
// softDeleteEmployeeAction
// ---------------------------------------------------------------------------

/**
 * Initiates the 24-hour soft-delete grace window for an active employee.
 *
 * Sequencing (from handoff S-2 / softDeleteEmployeeAction spec):
 *   Step 1: RPC soft_delete_employee (sets deletion_scheduled_at)
 *   Step 2: banUser (revokes login access immediately — RD-02)
 *
 * Authorization: enforced here (Server Action is the sole auth gate).
 *   DB RPC guards are defense-in-depth but will not fire under service-role.
 */
export async function softDeleteEmployeeAction(
  targetProfileId: string
): Promise<ActionResult<SoftDeleteResult>> {
  try {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: profileIdError },
      };
    }

    const caller = await getCallerProfile();
    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to perform this action.",
        },
      };
    }

    // Authorization guard — Server Action is the primary enforcement gate.
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      };
    }

    const employeesService = getEmployeesService();

    // Fetch the target BEFORE the RPC to capture email and companyId for the
    // audit log and for cross-company guard.
    const target = await employeesService.getEmployee(targetProfileId, caller);
    if (!target) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Employee not found. The page may be out of date — please refresh.",
        },
      };
    }

    // Cross-company guard for company admins.
    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You cannot perform this action on an employee in a different company.",
        },
      };
    }

    // Platform admin protection guard.
    if (target.isPlatformAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Platform admin accounts cannot be deleted.",
        },
      };
    }

    // Status guard — soft-delete only on active employees (RD-01).
    if (target.status === "pending") {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "This invitation must be cancelled, not deleted. Use 'Cancel Invite' instead.",
        },
      };
    }
    if (target.status !== "active") {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Only active employees can be scheduled for deletion.",
        },
      };
    }

    // Last-admin self-delete guard — if caller IS the target, verify another
    // active admin exists in the same company.
    if (caller.id === targetProfileId) {
      const allEmployees = await employeesService.listEmployees(
        target.companyId,
        caller
      );
      const remainingAdmins = allEmployees.filter(
        (e) =>
          e.role === "admin" &&
          e.status !== "deactivated" &&
          e.id !== targetProfileId
      );
      if (remainingAdmins.length === 0) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "You must promote another admin before deleting your own account.",
          },
        };
      }
    }

    const serviceClient = getSupabaseServiceRoleClient();

    // Step 1: RPC — sets deletion_scheduled_at.
    const { data: rpcData, error: rpcError } = await serviceClient.rpc(
      "soft_delete_employee",
      { p_target_profile_id: targetProfileId }
    );

    if (rpcError) {
      throw mapLifecycleRpcError(rpcError, "softDeleteEmployeeAction");
    }

    const rpcResult = rpcData as { success: boolean; deletion_scheduled_at: string };

    // Step 2: ban the user (revoke login access immediately — RD-02).
    // If the ban fails, the profile is in the grace window but the user can
    // still log in until their JWT refreshes. Log the inconsistency but do
    // NOT roll back the RPC (the deletion schedule is still correct in the DB).
    const { error: banError } = await serviceClient.auth.admin.updateUserById(
      targetProfileId,
      { ban_duration: "876000h" }
    );

    if (banError) {
      console.error(
        "[softDeleteEmployeeAction] Auth ban failed after successful soft-delete RPC. " +
          `targetProfileId: ${targetProfileId}. The profile is in the grace window ` +
          "but the user may still be able to log in until their JWT refreshes. " +
          "Manual ban via Supabase Dashboard is recommended.",
        banError
      );
      // Do NOT return error — the deletion was scheduled. The ban failure is an
      // ops concern. Return success so the UI can show the grace window state.
    }

    // The soft_delete_employee RPC writes the 'soft_deleted' audit log entry
    // atomically inside its own transaction. No additional log write is needed
    // here — a second write would produce a duplicate row and create a race
    // condition if this call fails after the RPC has already committed.

    return {
      success: true,
      data: { deletionScheduledAt: rpcResult.deletion_scheduled_at },
    };
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// hardDeleteEmployeeAction
// ---------------------------------------------------------------------------

/**
 * Immediately and irreversibly deletes an employee's profile and auth identity.
 *
 * CRITICAL sequencing (S-2 from reviewer):
 *   Step 1: banUser FIRST  — revokes the session immediately (prevents a
 *           window where the JWT remains valid after the profiles row is gone).
 *   Step 2: RPC hard_delete_employee — writes hard_deleted log entry + deletes
 *           the profiles row.
 *   Step 3: deleteUser AFTER — removes the auth.users row.
 *
 * Failure handling:
 *   Step 1 fails → abort. Profile untouched.
 *   Step 2 fails → unban (roll back ban). Profile untouched.
 *   Step 3 fails → profile gone, auth.users row orphaned. Log the orphan for
 *                  the auth-sweep cron to clean up. Do NOT try to restore
 *                  the profile — it's deleted.
 */
export async function hardDeleteEmployeeAction(
  targetProfileId: string
): Promise<ActionResult<HardDeleteResult>> {
  try {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: profileIdError },
      };
    }

    const caller = await getCallerProfile();
    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to perform this action.",
        },
      };
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      };
    }

    const employeesService = getEmployeesService();

    // Fetch target BEFORE the operation to capture email/companyId for the log
    // and for cross-company / platform-admin / last-admin guards.
    const target = await employeesService.getEmployee(targetProfileId, caller);
    if (!target) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Employee not found. The page may be out of date — please refresh.",
        },
      };
    }

    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You cannot perform this action on an employee in a different company.",
        },
      };
    }

    if (target.isPlatformAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Platform admin accounts cannot be deleted.",
        },
      };
    }

    // Pending profiles must use cancelInvite instead.
    if (target.status === "pending") {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "This invitation must be cancelled, not deleted. Use 'Cancel Invite' instead.",
        },
      };
    }

    // Last-admin self-delete guard.
    if (caller.id === targetProfileId) {
      const allEmployees = await employeesService.listEmployees(
        target.companyId,
        caller
      );
      const remainingAdmins = allEmployees.filter(
        (e) =>
          e.role === "admin" &&
          e.status !== "deactivated" &&
          e.id !== targetProfileId
      );
      if (remainingAdmins.length === 0) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "You must promote another admin before deleting your own account.",
          },
        };
      }
    }

    const serviceClient = getSupabaseServiceRoleClient();

    // Step 1: ban FIRST to prevent the deleted user's JWT from remaining
    // valid after the profiles row is gone (S-2 reviewer requirement).
    const { error: banError } = await serviceClient.auth.admin.updateUserById(
      targetProfileId,
      { ban_duration: "876000h" }
    );

    if (banError) {
      // Step 1 failed — abort entirely. Profile is untouched.
      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to revoke the user's session before deletion. No changes have been made. Please try again.",
        banError
      );
    }

    // Step 2: RPC — writes hard_deleted log entry + deletes the profiles row.
    const { error: rpcError } = await serviceClient.rpc(
      "hard_delete_employee",
      { p_target_profile_id: targetProfileId }
    );

    if (rpcError) {
      // Step 2 failed — roll back the ban so the user can still log in.
      const { error: unbanError } = await serviceClient.auth.admin.updateUserById(
        targetProfileId,
        { ban_duration: "none" }
      );
      if (unbanError) {
        // Unban failed — profile is untouched but the user is now banned with no
        // corresponding DB change. Needs manual remediation.
        console.error(
          "[hardDeleteEmployeeAction] RPC failed AND unban rollback failed. " +
            `targetProfileId: ${targetProfileId}. The profile is NOT deleted but ` +
            "the auth account is banned. Manual unban via Supabase Dashboard required.",
          { rpcError, unbanError }
        );
      }
      throw mapLifecycleRpcError(rpcError, "hardDeleteEmployeeAction");
    }

    // Step 3: delete the auth.users row.
    const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(
      targetProfileId
    );

    if (deleteAuthError) {
      // Profile is gone. The auth.users row is orphaned. The auth-sweep cron
      // will clean it up. Log the orphan for visibility.
      // Do NOT try to restore the profile — it's deleted.
      console.error(
        "[hardDeleteEmployeeAction] auth.admin.deleteUser failed after successful profile deletion. " +
          `targetProfileId: ${targetProfileId}. The profiles row is DELETED but the ` +
          "auth.users row persists (orphaned). The auth-sweep cron will clean this up. " +
          "The user cannot log in (no profiles row for JWT hook). " +
          "Manual remediation via Supabase Dashboard or auth-sweep endpoint if urgent.",
        deleteAuthError
      );
      // Return success — the deletion was completed from a data perspective.
      // The orphaned auth.users row is a cleanup concern, not a data integrity issue.
    }

    // The RPC writes the hard_deleted log entry internally (writes BEFORE the
    // profiles DELETE so the log row captures the email). No additional log write
    // needed here for the primary action.

    return { success: true, data: { success: true } };
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// undoScheduledDeletionAction
// ---------------------------------------------------------------------------

/**
 * Cancels a soft-delete grace window and restores the employee's access.
 *
 * Sequencing:
 *   Step 1: RPC cancel_scheduled_deletion — clears deletion_scheduled_at.
 *   Step 2: unban — restores login access (only called if RPC returns success).
 *
 * Race case (EC-07): if the pg_cron job promoted the deletion between the
 * admin clicking "Cancel" and the RPC executing, the RPC returns
 * { success: false, reason: 'already_deleted' }. We surface this as a specific
 * error code so the UI can show appropriate copy.
 */
export async function undoScheduledDeletionAction(
  targetProfileId: string
): Promise<ActionResult<UndoScheduledDeletionResult>> {
  try {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: profileIdError },
      };
    }

    const caller = await getCallerProfile();
    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to perform this action.",
        },
      };
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      };
    }

    // Fetch target for cross-company guard and log data.
    // Note: if the profile was already deleted by the cron, getEmployee returns null
    // before we even reach the RPC. We treat that as 'already_deleted'.
    const employeesService = getEmployeesService();
    const target = await employeesService.getEmployee(targetProfileId, caller);
    if (!target) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "This account has already been deleted and cannot be restored.",
        },
      };
    }

    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You cannot perform this action on an employee in a different company.",
        },
      };
    }

    const serviceClient = getSupabaseServiceRoleClient();

    // Step 1: RPC — clears deletion_scheduled_at.
    const { data: rpcData, error: rpcError } = await serviceClient.rpc(
      "cancel_scheduled_deletion",
      { p_target_profile_id: targetProfileId }
    );

    if (rpcError) {
      throw mapLifecycleRpcError(rpcError, "undoScheduledDeletionAction");
    }

    const rpcResult = rpcData as {
      success: boolean;
      noop?: boolean;
      reason?: string;
    };

    // Concurrency race (EC-07): cron promoted the deletion before cancel arrived.
    if (!rpcResult.success && rpcResult.reason === "already_deleted") {
      return {
        success: true,
        data: {
          cancelled: false,
          reason: "already_deleted",
        },
      };
    }

    // Step 2: unban — restore login access (RD-02).
    // The RPC wrote 'deletion_undone' log entry internally on success.
    const { error: unbanError } = await serviceClient.auth.admin.updateUserById(
      targetProfileId,
      { ban_duration: "none" }
    );

    if (unbanError) {
      // Unban failed — profile shows active in DB, but Auth still blocks login.
      // Log for ops visibility. The admin may need to retry or manually unban.
      console.error(
        "[undoScheduledDeletionAction] Auth unban failed after successful cancel_scheduled_deletion RPC. " +
          `targetProfileId: ${targetProfileId}. The deletion is cancelled in the DB ` +
          "but the user's Auth account is still banned. Manual unban required via " +
          "Supabase Dashboard.",
        unbanError
      );
      // Return success — the deletion was cancelled. The ban failure is an ops
      // concern that should not fail the user-visible operation.
    }

    return {
      success: true,
      data: { cancelled: true },
    };
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// cancelInviteAction
// ---------------------------------------------------------------------------

/**
 * Cancels a pending invitation — deletes the profiles row and the auth identity.
 *
 * Sequencing (per handoff — note: differs from original PRD EC-08 which said
 * auth first; the RPC now wraps the profiles DELETE so sequencing is RPC-first):
 *   Step 1: RPC cancel_invite — writes invite_cancelled log + deletes profiles row.
 *   Step 2: deleteUser — removes auth.users row.
 *
 * If step 2 fails: profiles row is already deleted. The orphaned auth.users row
 * will be swept by the auth-sweep cron endpoint. Per user's OQ-3 decision:
 * SILENT failure — do not log an additional error entry, do not return error
 * to the user. The invite link is already invalid (no profiles row = no JWT
 * claims from the hook).
 */
export async function cancelInviteAction(
  targetProfileId: string
): Promise<ActionResult<CancelInviteResult>> {
  try {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: profileIdError },
      };
    }

    const caller = await getCallerProfile();
    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to perform this action.",
        },
      };
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      };
    }

    // Fetch target for cross-company guard.
    const employeesService = getEmployeesService();
    const target = await employeesService.getEmployee(targetProfileId, caller);
    if (!target) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Employee not found. The page may be out of date — please refresh.",
        },
      };
    }

    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You cannot perform this action on an employee in a different company.",
        },
      };
    }

    // Defensive guard — the RPC also enforces this (G17), but check here for
    // a cleaner error message before the round-trip.
    if (target.status !== "pending") {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message:
            "This invitation has already been accepted. Refresh the page and manage the employee from the active employees list.",
        },
      };
    }

    const serviceClient = getSupabaseServiceRoleClient();

    // Step 1: RPC — writes invite_cancelled log BEFORE the profiles DELETE,
    // then deletes the profiles row.
    const { error: rpcError } = await serviceClient.rpc("cancel_invite", {
      p_target_profile_id: targetProfileId,
    });

    if (rpcError) {
      throw mapLifecycleRpcError(rpcError, "cancelInviteAction");
    }

    // Step 2: delete the auth.users row.
    // SILENT on failure (OQ-3): if auth deletion fails, the profiles row is
    // already gone. The orphaned auth.users row will be swept by the auth-sweep
    // cron. We do NOT return an error to the UI — the invite is effectively
    // cancelled (the invite link is invalid without a profiles row).
    const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(
      targetProfileId
    );

    if (deleteAuthError) {
      // Structured log for ops visibility — not surfaced to the user (OQ-3).
      console.error(
        "[cancelInviteAction] auth.admin.deleteUser failed after successful cancel_invite RPC. " +
          `targetProfileId: ${targetProfileId}. The profiles row is DELETED but the ` +
          "auth.users row persists (orphaned). The auth-sweep cron will clean this up. " +
          "The invite link is already invalid (no profiles row for JWT hook claims). " +
          "This is expected behavior per OQ-3 — no additional error log entry written.",
        deleteAuthError
      );
    }

    return { success: true, data: { success: true } };
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// resendInviteAction
// ---------------------------------------------------------------------------

/**
 * Resends an invitation email to a pending employee.
 *
 * Refreshes the invite token via auth.admin.inviteUserByEmail.
 * Supabase's invite API replaces the previous token on a second call for the
 * same email — the profile row is reused without modification (FR-10).
 *
 * Sequencing:
 *   Step 1: Validate target status = 'pending' (FR-11 guard).
 *   Step 2: inviteUserByEmail — refreshes the invite token.
 *   Step 3: writeLifecycleLog 'invite_resent'.
 */
export async function resendInviteAction(
  targetProfileId: string,
  email: string
): Promise<ActionResult<ResendInviteResult>> {
  try {
    const profileIdError = validateUUID(targetProfileId, "Profile ID");
    if (profileIdError) {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: profileIdError },
      };
    }

    const emailError = validateEmail(email);
    if (emailError) {
      return {
        success: false,
        error: { code: "VALIDATION_ERROR", message: emailError },
      };
    }

    const caller = await getCallerProfile();
    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to perform this action.",
        },
      };
    }

    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      };
    }

    // Fetch target for status check (FR-11) and log data.
    const employeesService = getEmployeesService();
    const target = await employeesService.getEmployee(targetProfileId, caller);
    if (!target) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Employee not found. The page may be out of date — please refresh.",
        },
      };
    }

    if (!caller.isPlatformAdmin && target.companyId !== caller.companyId) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You cannot perform this action on an employee in a different company.",
        },
      };
    }

    // FR-11: resend is only valid for pending profiles.
    if (target.status !== "pending") {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message:
            "This employee has already accepted their invitation. No new invite email was sent.",
        },
      };
    }

    // Defensive email match — verify the caller-supplied email matches the
    // actual email stored on the target profile. A mismatched email would send
    // the refreshed invite token to the wrong address while updating the correct
    // auth.users row. This can happen if the UI state is stale or a client bug
    // passes the wrong value.
    if (email.trim().toLowerCase() !== target.email?.toLowerCase()) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Email does not match the invitation record.",
        },
      };
    }

    const serviceClient = getSupabaseServiceRoleClient();
    const normalizedEmail = email.trim().toLowerCase();

    // Step 2: refresh the invite token.
    // Supabase replaces the existing pending invite token on a second call
    // with the same email — the auth.users row and profiles row are preserved.
    const { error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: {},
        redirectTo: `${APP_URL}/accept-invite`,
      });

    if (inviteError) {
      // Supabase returns a 422 or "already registered" if the email has
      // transitioned to active between our status check and this call.
      const lower = inviteError.message.toLowerCase();
      if (
        lower.includes("already registered") ||
        lower.includes("already been registered") ||
        inviteError.status === 422
      ) {
        return {
          success: false,
          error: {
            code: "CONFLICT",
            message:
              "This employee has already accepted their invitation. Refresh the page.",
          },
        };
      }

      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to resend the invitation. Please try again.",
        inviteError
      );
    }

    // Step 3: audit log.
    try {
      await writeLifecycleLog({
        actorProfileId: caller.id,
        targetProfileId,
        targetEmail: normalizedEmail,
        targetCompanyId: target.companyId,
        action: "invite_resent",
      });
    } catch (logError) {
      if (logError instanceof LogWriteError) {
        console.error(
          "[resendInviteAction] Audit log write failed after successful invite resend.",
          { targetProfileId, email: normalizedEmail },
          logError
        );
      }
    }

    return { success: true, data: { success: true } };
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: { code: error.code, message: error.message } };
    }
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}
