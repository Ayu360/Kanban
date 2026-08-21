/**
 * SupabaseEmployeesRepository — Supabase implementation of EmployeesRepository.
 *
 * This is the ONLY file in the employees feature allowed to call Supabase
 * clients directly. All Supabase-specific types (PostgrestError, AuthApiError)
 * are caught here and re-thrown as AppError so the service layer and hooks
 * never see Supabase internals (ADR-0004).
 *
 * Client usage:
 *   - getSupabaseServiceRoleClient() — for all admin reads (admin_employee_list),
 *     all RPC calls (change_employee_role, deactivate_employee, reactivate_employee),
 *     invite, banUser, and unbanUser.
 *   - getSupabaseServerClient() — for employee_directory reads (authenticated, RLS).
 *     NOTE: activate_invited_employee uses the authenticated session client so
 *     the RPC can read auth.uid() from the actual user session.
 *
 * View access (H-2 contract):
 *   - `public.employee_directory` — authenticated client. Returns id, display_name, role.
 *   - `public.admin_employee_list` — service-role client only. Returns full shape + email.
 *   - NEVER query `public.profiles` directly for directory/list reads.
 *
 * RPC contract:
 *   - change_employee_role, deactivate_employee, reactivate_employee — service_role only.
 *   - activate_invited_employee — authenticated (invited user's session).
 *   - NO p_caller_id params are passed to any RPC — identity comes from auth.uid() in the DB.
 */

import "server-only";

import type { EmployeesRepository } from "./EmployeesRepository";
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
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { APP_URL } from "@/lib/env.server";

// ---------------------------------------------------------------------------
// PostgreSQL / PostgREST error code constants
// ---------------------------------------------------------------------------

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_NO_DATA_FOUND = "P0002";
const PG_INVALID_PARAMETER_VALUE = "22023";
const POSTGREST_NO_ROWS = "PGRST116";

// ---------------------------------------------------------------------------
// Private row type — shape returned by admin_employee_list view queries.
// Centralised here so listByCompany, getById, findByEmail, and rowToAdminEmployee
// all reference the same definition rather than duplicating the inline type.
// ---------------------------------------------------------------------------

type AdminEmployeeRow = {
  id: string;
  company_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  status: string;
  deactivated_at: string | null;
  deletion_scheduled_at: string | null;
  is_platform_admin: boolean;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Row-to-DTO mappers
// ---------------------------------------------------------------------------

function rowToAdminEmployee(row: AdminEmployeeRow): AdminEmployee {
  return {
    id: row.id,
    companyId: row.company_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status as AdminEmployee["status"],
    deactivatedAt: row.deactivated_at,
    deletionScheduledAt: row.deletion_scheduled_at,
    isPlatformAdmin: row.is_platform_admin,
    createdAt: row.created_at,
  };
}

function rowToEmployee(row: {
  id: string;
  display_name: string | null;
  role: string;
}): Employee {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
  };
}

// ---------------------------------------------------------------------------
// Error mapper
// ---------------------------------------------------------------------------

/**
 * Maps a PostgrestError or raw error into an AppError.
 *
 * Employees-specific error codes:
 *   P0002 (no_data_found)          → NOT_FOUND
 *   42501 (insufficient_privilege) → FORBIDDEN or LAST_ADMIN_LOCKOUT or CANNOT_DEACTIVATE_PENDING
 *   23505 (unique_violation)       → CONFLICT
 *   23514 (check_violation)        → VALIDATION_ERROR or LAST_ADMIN_LOCKOUT
 *   22023 (invalid_parameter_value)→ VALIDATION_ERROR
 *   PGRST116                       → NOT_FOUND (no rows from single())
 *   anything else                  → UNKNOWN_ERROR
 *
 * Error message prefixes from the RPCs are used to produce user-facing messages:
 *   last_admin_lockout:           — last admin guard
 *   self_modification_denied:     — self-demotion attempt
 *   self_deactivation_denied:     — self-deactivation attempt
 *   cross_company_denied:         — cross-company access
 *   cannot_deactivate_pending:    — deactivating a pending profile
 *   cannot_activate_deactivated:  — deactivated user trying to self-activate
 *   target_not_found:             — target profile missing
 *   invalid_state:                — invalid state transition
 */
function mapPostgrestError(
  error: { code?: string; message?: string; details?: string | null },
  context: string
): AppError {
  const code = error.code ?? "";
  const message = error.message ?? "";
  const lower = message.toLowerCase();

  // Check message prefixes first for user-facing messages
  if (lower.startsWith("last_admin_lockout:")) {
    return new AppError(
      "FORBIDDEN",
      "Cannot complete this action: the company must always have at least one active admin.",
      error
    );
  }

  if (lower.startsWith("self_modification_denied:")) {
    return new AppError(
      "FORBIDDEN",
      "You cannot change your own role. Ask another admin to make this change.",
      error
    );
  }

  if (lower.startsWith("self_deactivation_denied:")) {
    return new AppError(
      "FORBIDDEN",
      "You cannot deactivate your own account.",
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

  if (lower.startsWith("cannot_deactivate_pending:")) {
    return new AppError(
      "VALIDATION_ERROR",
      "Pending invitations cannot be deactivated. Revoke the invitation instead.",
      error
    );
  }

  if (lower.startsWith("cannot_activate_deactivated:")) {
    return new AppError(
      "FORBIDDEN",
      "This account has been deactivated. Contact your administrator to restore access.",
      error
    );
  }

  if (lower.startsWith("target_not_found:") || lower.startsWith("profile_not_found:")) {
    return new AppError(
      "NOT_FOUND",
      "The employee profile was not found.",
      error
    );
  }

  if (lower.startsWith("invalid_state:")) {
    return new AppError(
      "VALIDATION_ERROR",
      "This action is not valid for the employee's current status.",
      error
    );
  }

  if (lower.startsWith("permission_denied:")) {
    return new AppError(
      "FORBIDDEN",
      "You do not have permission to perform this action.",
      error
    );
  }

  // Fall through to SQLSTATE-based mapping
  switch (code) {
    case PG_NO_DATA_FOUND:
      return new AppError("NOT_FOUND", "Employee profile not found.", error);

    case PG_INSUFFICIENT_PRIVILEGE:
      return new AppError(
        "FORBIDDEN",
        "You do not have permission to perform this action.",
        error
      );

    case PG_UNIQUE_VIOLATION:
      return new AppError(
        "CONFLICT",
        "This email address is already registered.",
        error
      );

    case PG_CHECK_VIOLATION:
      return new AppError("VALIDATION_ERROR", "Validation failed.", error);

    case PG_INVALID_PARAMETER_VALUE:
      return new AppError(
        "VALIDATION_ERROR",
        "This action is not valid for the employee's current status.",
        error
      );

    case POSTGREST_NO_ROWS:
      return new AppError("NOT_FOUND", `${context} not found.`, error);

    default:
      if (
        lower.includes("insufficient_privilege") ||
        lower.includes("permission denied")
      ) {
        return new AppError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          error
        );
      }
      return new AppError(
        "UNKNOWN_ERROR",
        `An unexpected error occurred in ${context}. Please try again.`,
        error
      );
  }
}

// ---------------------------------------------------------------------------
// SupabaseEmployeesRepository
// ---------------------------------------------------------------------------

export class SupabaseEmployeesRepository implements EmployeesRepository {
  // -------------------------------------------------------------------------
  // listByCompany — admin_employee_list view, service-role
  // -------------------------------------------------------------------------
  async listByCompany(callerCompanyId: string): Promise<AdminEmployee[]> {
    const serviceClient = getSupabaseServiceRoleClient();

    // The admin_employee_list view is NOT company-scoped.
    // We MUST apply WHERE company_id = callerCompanyId (handoff NEW-1).
    const { data, error } = await serviceClient
      .from("admin_employee_list")
      .select(
        "id, company_id, display_name, email, role, status, deactivated_at, deletion_scheduled_at, is_platform_admin, created_at"
      )
      .eq("company_id", callerCompanyId)
      .order("display_name", { ascending: true, nullsFirst: false });

    if (error) {
      throw mapPostgrestError(error, "listByCompany");
    }

    return (data ?? []).map((row) =>
      rowToAdminEmployee(row as unknown as AdminEmployeeRow)
    );
  }

  // -------------------------------------------------------------------------
  // getById — admin_employee_list view, service-role
  // -------------------------------------------------------------------------
  async getById(profileId: string): Promise<AdminEmployee | null> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { data, error } = await serviceClient
      .from("admin_employee_list")
      .select(
        "id, company_id, display_name, email, role, status, deactivated_at, deletion_scheduled_at, is_platform_admin, created_at"
      )
      .eq("id", profileId)
      .single();

    if (error) {
      if (error.code === POSTGREST_NO_ROWS) {
        return null;
      }
      throw mapPostgrestError(error, "getById");
    }

    if (!data) return null;

    return rowToAdminEmployee(data as unknown as AdminEmployeeRow);
  }

  // -------------------------------------------------------------------------
  // listDirectory — employee_directory view, authenticated client
  // -------------------------------------------------------------------------
  async listDirectory(): Promise<Employee[]> {
    // The employee_directory view scopes by company_id via JWT internally.
    // No additional WHERE clause needed (and none should be added —
    // see handoff: do not add company_id or status filters).
    const supabase = await getSupabaseServerClient();

    const { data, error } = await supabase
      .from("employee_directory")
      .select("id, display_name, role")
      .order("display_name", { ascending: true, nullsFirst: false });

    if (error) {
      throw mapPostgrestError(error, "listDirectory");
    }

    type DirectoryRow = {
      id: string;
      display_name: string | null;
      role: string;
    };

    return (data ?? []).map((row) =>
      rowToEmployee(row as unknown as DirectoryRow)
    );
  }

  // -------------------------------------------------------------------------
  // findByEmail — admin_employee_list view, service-role
  // -------------------------------------------------------------------------
  async findByEmail(
    email: string,
    companyId: string
  ): Promise<AdminEmployee | null> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { data, error } = await serviceClient
      .from("admin_employee_list")
      .select(
        "id, company_id, display_name, email, role, status, deactivated_at, deletion_scheduled_at, is_platform_admin, created_at"
      )
      .eq("email", email)
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) {
      throw mapPostgrestError(error, "findByEmail");
    }

    if (!data) return null;

    return rowToAdminEmployee(data as unknown as AdminEmployeeRow);
  }

  // -------------------------------------------------------------------------
  // invite — Auth admin API + profiles insert, service-role
  // -------------------------------------------------------------------------
  async invite(
    email: string,
    callerCompanyId: string
  ): Promise<InviteEmployeeResult> {
    const serviceClient = getSupabaseServiceRoleClient();

    // Step 1: create the auth user via the Auth admin invite API.
    // This sends the invitation email with a magic link that points to:
    //   {APP_URL}/accept-invite
    //
    // Supabase's inviteUserByEmail uses the IMPLICIT flow — tokens arrive in the
    // URL hash fragment (#access_token=...&type=invite), NOT as a ?code= query
    // param. Hash fragments are never sent to the server, so routing through
    // /api/auth/callback (which expects a PKCE ?code= param) would fail.
    //
    // Flow:
    //   1. Invitee clicks the link → browser navigates to {APP_URL}/accept-invite
    //      with #access_token=...&type=invite in the URL hash.
    //   2. The browser-side Supabase client (detectSessionInUrl: true, the SDK
    //      default) reads the hash fragment and establishes the session
    //      client-side.
    //   3. /accept-invite renders the set-password + display-name form.
    //   4. On submit, activateInvitedEmployeeAction is called to transition
    //      the profile from status='pending' to status='active'.
    //
    // Required Dashboard config: the redirectTo URL must appear on the Supabase
    // Dashboard > Authentication > URL Configuration > Redirect URLs allowlist —
    // otherwise Supabase silently falls back to SITE_URL and invite links break.
    // Ensure the following (or a wildcard covering it) is listed for every
    // deployed environment:
    //   {APP_URL}/accept-invite
    // e.g. http://localhost:3000/accept-invite, https://<your-domain>/accept-invite
    // A wildcard like http://localhost:3000/** covers this path for local dev.
    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: {},
        redirectTo: `${APP_URL}/accept-invite`,
      });

    if (inviteError) {
      const lower = inviteError.message.toLowerCase();

      // Catch "email already registered" — Supabase Auth returns this when the
      // email is already in auth.users (within or outside this company).
      if (
        lower.includes("already registered") ||
        lower.includes("already been registered") ||
        lower.includes("email address is already") ||
        inviteError.status === 422
      ) {
        throw new AppError(
          "CONFLICT",
          "This email address is already registered in the system.",
          inviteError
        );
      }

      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to send the invitation. Please try again.",
        inviteError
      );
    }

    const newUserId = inviteData.user.id;

    // Step 2: insert the profiles row immediately with status='pending'.
    // This makes the invited user visible in the admin employee list right away.
    const { data: profileData, error: profileError } = await serviceClient
      .from("profiles")
      .insert({
        id: newUserId,
        company_id: callerCompanyId,
        role: "employee",
        status: "pending",
        display_name: null,
        is_platform_admin: false,
      })
      .select("id")
      .single();

    if (profileError) {
      // The auth user was created but the profile insert failed.
      // Log the inconsistency — ops can clean up the orphaned auth user.
      // We throw so the caller knows the invite was only partially completed.
      console.error(
        "[SupabaseEmployeesRepository.invite] Profile insert failed after auth user creation. " +
          `Auth userId: ${newUserId}, company: ${callerCompanyId}. ` +
          "The auth.users row exists without a corresponding profile row. " +
          "Manual cleanup may be required.",
        profileError
      );

      throw mapPostgrestError(profileError, "invite (profile insert)");
    }

    return { profileId: profileData.id };
  }

  // -------------------------------------------------------------------------
  // changeRole — change_employee_role RPC, service-role
  // -------------------------------------------------------------------------
  async changeRole(
    targetProfileId: string,
    newRole: "admin" | "employee"
  ): Promise<ChangeRoleResult> {
    const serviceClient = getSupabaseServiceRoleClient();

    // IMPORTANT: Do NOT pass a p_caller_id parameter.
    // The RPC reads auth.uid() from the session JWT internally.
    // However, service-role does not carry a user session — the RPC's
    // auth.uid() will return null in this context. This is intentional:
    // the service-layer authz check (isPlatformAdmin || role === 'admin')
    // is the primary authorization guard. The RPC's internal guards provide
    // defense-in-depth when called from an authenticated session context.
    //
    // NOTE: Because we use service-role, the RPC's internal auth.uid() and
    // auth.jwt() calls will return null (no session). The DB authz guards
    // (G1-G7) rely on auth.uid()/auth.jwt() and will not fire in this path.
    // The service layer is therefore the SOLE authorization enforcer here.
    // This matches the established Teams pattern (addMember, delete via service-role).
    const { data, error } = await serviceClient.rpc("change_employee_role", {
      p_target_profile_id: targetProfileId,
      p_new_role: newRole,
    });

    if (error) {
      throw mapPostgrestError(error, "changeRole");
    }

    if (!data || typeof data !== "object") {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Role change returned no data. Please try again."
      );
    }

    const result = data as {
      success: boolean;
      old_role: string;
      new_role: string;
      noop: boolean;
    };

    return {
      oldRole: result.old_role,
      newRole: result.new_role,
      noop: result.noop ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // deactivate — deactivate_employee RPC, service-role
  // -------------------------------------------------------------------------
  async deactivate(targetProfileId: string): Promise<DeactivateResult> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { data, error } = await serviceClient.rpc("deactivate_employee", {
      p_target_profile_id: targetProfileId,
    });

    if (error) {
      throw mapPostgrestError(error, "deactivate");
    }

    if (!data || typeof data !== "object") {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Deactivation returned no data. Please try again."
      );
    }

    const result = data as {
      success: boolean;
      previous_status?: string;
      status: string;
      noop: boolean;
    };

    return {
      previousStatus: result.previous_status ?? "active",
      status: result.status as DeactivateResult["status"],
      noop: result.noop ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // reactivate — reactivate_employee RPC, service-role
  // -------------------------------------------------------------------------
  async reactivate(targetProfileId: string): Promise<ReactivateResult> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { data, error } = await serviceClient.rpc("reactivate_employee", {
      p_target_profile_id: targetProfileId,
    });

    if (error) {
      throw mapPostgrestError(error, "reactivate");
    }

    if (!data || typeof data !== "object") {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Reactivation returned no data. Please try again."
      );
    }

    const result = data as {
      success: boolean;
      previous_status?: string;
      status: string;
      noop: boolean;
    };

    return {
      previousStatus: result.previous_status ?? "deactivated",
      status: result.status as ReactivateResult["status"],
      noop: result.noop ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // activateInvited — activate_invited_employee RPC, AUTHENTICATED client
  // -------------------------------------------------------------------------
  async activateInvited(): Promise<ActivateInvitedResult> {
    // CRITICAL: use the authenticated server client (with the user's session cookie),
    // NOT the service-role client. The RPC reads auth.uid() to identify the caller —
    // calling it with service-role would make auth.uid() return null and fail.
    // This RPC is GRANT'd to 'authenticated', NOT 'service_role'.
    const supabase = await getSupabaseServerClient();

    const { data, error } = await supabase.rpc("activate_invited_employee");

    if (error) {
      throw mapPostgrestError(error, "activateInvited");
    }

    if (!data || typeof data !== "object") {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Invite activation returned no data. Please try again."
      );
    }

    const result = data as {
      success: boolean;
      previous_status?: string;
      status: string;
      noop: boolean;
    };

    return {
      previousStatus: result.previous_status,
      status: result.status as ActivateInvitedResult["status"],
      noop: result.noop ?? false,
    };
  }

  // -------------------------------------------------------------------------
  // banUser — Auth admin API, service-role
  // -------------------------------------------------------------------------
  // This project maintains profiles.id = auth.users.id — established at signup
  // (createProfile RPC uses auth.users.id as the profile PK) and at invite time
  // (inviteUserByEmail's returned user.id becomes the profile PK). The profileId
  // passed here is therefore the same UUID as the Auth user ID. If the ID
  // strategy ever diverges, this ban path targets the wrong Auth user.
  async banUser(targetAuthId: string): Promise<void> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { error } = await serviceClient.auth.admin.updateUserById(
      targetAuthId,
      {
        // 876000h ≈ 100 years — practical permanent ban.
        // Supabase does not have a "permanent ban" concept; this is the established
        // convention (see handoff M-2).
        ban_duration: "876000h",
      }
    );

    if (error) {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to revoke the user's session. The account was deactivated in the database, but the user may remain logged in until their session expires.",
        error
      );
    }
  }

  // -------------------------------------------------------------------------
  // unbanUser — Auth admin API, service-role
  // -------------------------------------------------------------------------
  // This project maintains profiles.id = auth.users.id — established at signup
  // (createProfile RPC uses auth.users.id as the profile PK) and at invite time
  // (inviteUserByEmail's returned user.id becomes the profile PK). The profileId
  // passed here is therefore the same UUID as the Auth user ID. If the ID
  // strategy ever diverges, this unban path targets the wrong Auth user.
  async unbanUser(targetAuthId: string): Promise<void> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { error } = await serviceClient.auth.admin.updateUserById(
      targetAuthId,
      { ban_duration: "none" }
    );

    if (error) {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to restore the user's login access. The account was reactivated in the database, but they may not be able to log in until the Auth layer is manually unblocked.",
        error
      );
    }
  }
}
