/**
 * SupabaseAuthRepository — Supabase implementation of AuthRepository.
 *
 * This is the ONLY file in the auth feature that is allowed to call Supabase
 * clients directly. All Supabase-specific types (AuthError, PostgrestError)
 * are caught here and re-thrown as AppError so that the service layer and
 * hooks never see Supabase internals (ADR-0004).
 *
 * Two client factories are used:
 *   - getSupabaseServerClient()      — anon key + RLS. Used for sign-in, sign-out,
 *                                      password operations, and profile reads.
 *   - getSupabaseServiceRoleClient() — bypasses RLS. Used only for the
 *                                      create_profile_for_user RPC (ADR-0015).
 *
 * The DEFAULT_COMPANY_ID constant matches the UUID seeded in migration
 * 20260802000001_auth_schema.sql. The service layer passes this value;
 * the repository does not hard-code business decisions.
 */

import type { AuthRepository } from "./AuthRepository";
import type {
  Profile,
  Role,
  SignUpInput,
  SignInInput,
  ResetPasswordInput,
  UpdatePasswordInput,
  SignUpResult,
} from "../types";
import { AppError } from "../types";
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
// H-2: import validated APP_URL from env.server.ts so sendPasswordResetEmail
// never falls back to a localhost hardcode.
import { APP_URL } from "@/lib/env.server";
// H-3: import AuthError type for status/code-first error mapping.
import type { AuthError } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw profiles row from Supabase into a domain Profile DTO.
 * Keeps Supabase column naming (snake_case) isolated in this file.
 */
function rowToProfile(
  row: {
    id: string;
    company_id: string;
    role: string;
    is_platform_admin: boolean;
    display_name: string | null;
    created_at: string;
    updated_at: string;
  },
  email: string | null
): Profile {
  return {
    id: row.id,
    companyId: row.company_id,
    role: row.role as Role,
    isPlatformAdmin: row.is_platform_admin,
    displayName: row.display_name,
    email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a Supabase AuthError to an AppErrorCode.
 *
 * H-3 fix: Prefer error.code (GoTrue error codes) and error.status (HTTP
 * status) over substring matching of error.message. The error.code values
 * are stable contract values from @supabase/auth-js ErrorCode enum.
 * Message-substring matching is kept only as a last-resort fallback with a
 * version comment — if the SDK changes message text, the code/status path
 * still works correctly.
 *
 * SDK version at time of writing: @supabase/supabase-js@^2.111.0
 * (AuthError has .code: ErrorCode | string | undefined, .status: number | undefined)
 */
function mapAuthError(error: AuthError): AppError["code"] {
  // --- Primary path: match on error.code (GoTrue ErrorCode string) ---
  if (error.code) {
    switch (error.code) {
      case "invalid_credentials":
        return "AUTH_INVALID_CREDENTIALS";
      case "user_already_exists":
      case "email_exists":
        return "AUTH_EMAIL_ALREADY_IN_USE";
      case "weak_password":
        return "AUTH_WEAK_PASSWORD";
      case "user_not_found":
        return "AUTH_USER_NOT_FOUND";
      case "otp_expired":
      case "bad_jwt":
      case "session_expired":
      case "refresh_token_not_found":
      case "flow_state_expired":
        return "AUTH_TOKEN_INVALID";
    }
  }

  // --- Secondary path: match on error.status (HTTP status code) ---
  if (error.status === 400) {
    // 400 from GoTrue is almost always invalid credentials on sign-in.
    // Kept as a fallback in case error.code is absent (older server version).
    return "AUTH_INVALID_CREDENTIALS";
  }
  if (error.status === 422) {
    // 422 Unprocessable Entity from GoTrue typically means a duplicate email
    // or validation failure on signup.
    return "AUTH_EMAIL_ALREADY_IN_USE";
  }

  // --- Last-resort fallback: substring match on error.message ---
  // This path should not be reached with a current GoTrue server but is
  // retained defensively. If the GoTrue server predates error.code support,
  // we fall back to message matching.
  // SDK version: @supabase/supabase-js@^2.111.0
  const lower = error.message.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return "AUTH_INVALID_CREDENTIALS";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "AUTH_EMAIL_ALREADY_IN_USE";
  }
  if (lower.includes("password should be")) {
    return "AUTH_WEAK_PASSWORD";
  }
  if (lower.includes("user not found")) {
    return "AUTH_USER_NOT_FOUND";
  }
  if (
    lower.includes("token has expired") ||
    lower.includes("invalid token") ||
    lower.includes("otp has expired")
  ) {
    return "AUTH_TOKEN_INVALID";
  }

  return "UNKNOWN_ERROR";
}

// ---------------------------------------------------------------------------
// SupabaseAuthRepository
// ---------------------------------------------------------------------------

export class SupabaseAuthRepository implements AuthRepository {
  // -------------------------------------------------------------------------
  // createAuthUser
  // -------------------------------------------------------------------------
  async createAuthUser(
    input: SignUpInput
  ): Promise<{ userId: string; email: string }> {
    const supabase = await getSupabaseServerClient();

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
    });

    if (error) {
      // H-3: use code/status-first mapping
      throw new AppError(
        mapAuthError(error),
        this._safeAuthErrorMessage(error.message),
        error
      );
    }

    if (!data.user) {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Sign up completed but no user was returned. Please try again."
      );
    }

    return { userId: data.user.id, email: data.user.email ?? input.email };
  }

  // -------------------------------------------------------------------------
  // createProfile
  // -------------------------------------------------------------------------
  async createProfile(params: {
    userId: string;
    companyId: string;
    displayName?: string;
  }): Promise<SignUpResult> {
    // Must use the service-role client — the RPC is EXECUTE-granted to
    // service_role only (migration 20260802000002_jwt_sync_hook.sql).
    const serviceClient = getSupabaseServiceRoleClient();

    const { data, error } = await serviceClient.rpc("create_profile_for_user", {
      p_user_id: params.userId,
      p_company_id: params.companyId,
      p_display_name: params.displayName ?? null,
    });

    if (error) {
      // Distinguish "company not found" (FK violation) from generic failures.
      const message = error.message?.toLowerCase() ?? "";
      const code =
        message.includes("foreign key") || message.includes("company")
          ? "COMPANY_NOT_FOUND"
          : "PROFILE_CREATE_FAILED";

      throw new AppError(
        code,
        "Failed to create user profile. Please contact support if this persists.",
        error
      );
    }

    if (!data) {
      throw new AppError(
        "PROFILE_CREATE_FAILED",
        "Profile creation returned no data. Please try again."
      );
    }

    // The RPC returns { role, is_platform_admin, already_existed }.
    // We need the full profile row for the SignUpResult DTO, so we fetch it.
    const profile = await this._fetchProfileById(params.userId);
    if (!profile) {
      throw new AppError(
        "PROFILE_NOT_FOUND",
        "Profile was created but could not be retrieved. Please contact support."
      );
    }

    return { profile };
  }

  // -------------------------------------------------------------------------
  // signIn
  // -------------------------------------------------------------------------
  async signIn(input: SignInInput): Promise<Profile> {
    const supabase = await getSupabaseServerClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      // H-3: use code/status-first mapping
      throw new AppError(
        mapAuthError(error),
        // Always return a generic message for sign-in failures to prevent
        // email enumeration (FR-02: "Invalid email or password" for all failures).
        "Invalid email or password. Please check your credentials and try again.",
        error
      );
    }

    if (!data.user) {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Sign in completed but no user was returned. Please try again."
      );
    }

    const profile = await this._fetchProfileById(data.user.id, data.user.email ?? null);
    if (!profile) {
      throw new AppError(
        "PROFILE_NOT_FOUND",
        "Account exists but profile data was not found. Please contact support."
      );
    }

    return profile;
  }

  // -------------------------------------------------------------------------
  // signOut
  // -------------------------------------------------------------------------
  async signOut(): Promise<void> {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Sign out failed. Please try again.",
        error
      );
    }
  }

  // -------------------------------------------------------------------------
  // sendPasswordResetEmail
  // -------------------------------------------------------------------------
  async sendPasswordResetEmail(input: ResetPasswordInput): Promise<void> {
    const supabase = await getSupabaseServerClient();

    // C-2 + H-2: redirectTo points to /api/auth/callback which handles PKCE
    // code exchange server-side, then redirects to /reset-password/confirm.
    // APP_URL is validated at startup in env.server.ts — no localhost fallback.
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: `${APP_URL}/api/auth/callback?next=/reset-password/confirm`,
    });

    if (error) {
      // H-3: use code/status-first mapping.
      // Silently succeed for user_not_found — prevents email enumeration (FR-05).
      if (error.code === "user_not_found") return;

      // Fallback message-check for older GoTrue server versions.
      const lower = error.message?.toLowerCase() ?? "";
      if (lower.includes("user not found") || lower.includes("email not found")) return;

      throw new AppError(
        "UNKNOWN_ERROR",
        "Failed to send password reset email. Please try again later.",
        error
      );
    }
  }

  // -------------------------------------------------------------------------
  // updatePassword
  // -------------------------------------------------------------------------
  async updatePassword(input: UpdatePasswordInput): Promise<void> {
    const supabase = await getSupabaseServerClient();

    const { error } = await supabase.auth.updateUser({
      password: input.password,
    });

    if (error) {
      // H-3: use code/status-first mapping
      throw new AppError(
        mapAuthError(error),
        "Failed to update password. The reset link may have expired. Please request a new one.",
        error
      );
    }
  }

  // -------------------------------------------------------------------------
  // getCurrentProfile
  // -------------------------------------------------------------------------
  async getCurrentProfile(): Promise<Profile | null> {
    const supabase = await getSupabaseServerClient();

    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return null;
    }

    const profile = await this._fetchProfileById(user.id, user.email ?? null);
    if (!profile && user) {
      // User exists in auth but has no profile — configuration/migration error.
      throw new AppError(
        "PROFILE_NOT_FOUND",
        "Authenticated user has no profile. This is a configuration error. Please contact support."
      );
    }

    return profile;
  }

  // -------------------------------------------------------------------------
  // getSession
  // -------------------------------------------------------------------------
  async getSession(): Promise<{ userId: string; email: string | null } | null> {
    const supabase = await getSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    return { userId: user.id, email: user.email ?? null };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fetches a single profiles row by user ID using the server (anon) client.
   * The RLS profiles_select_own policy allows a user to read their own row.
   * Platform admins and company admins can read broader sets via their policies.
   *
   * Returns null if no row is found.
   */
  private async _fetchProfileById(
    userId: string,
    email?: string | null
  ): Promise<Profile | null> {
    const supabase = await getSupabaseServerClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, company_id, role, is_platform_admin, display_name, created_at, updated_at")
      .eq("id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // PostgREST "no rows returned" — profile does not exist yet.
        return null;
      }
      throw new AppError(
        "PROFILE_NOT_FOUND",
        "Failed to fetch user profile.",
        error
      );
    }

    if (!data) return null;

    // For email: if not passed by the caller (e.g. during createProfile),
    // attempt to get it from the current session.
    let resolvedEmail = email ?? null;
    if (resolvedEmail === undefined) {
      const { data: sessionData } = await supabase.auth.getUser();
      resolvedEmail = sessionData.user?.email ?? null;
    }

    return rowToProfile(data, resolvedEmail);
  }

  /**
   * Returns a safe, user-facing auth error message.
   * Strips internal Supabase error details that should not be exposed.
   */
  private _safeAuthErrorMessage(originalMessage: string): string {
    const lower = originalMessage.toLowerCase();

    if (lower.includes("user already registered") || lower.includes("already been registered")) {
      return "An account with this email address already exists. Please sign in instead.";
    }
    if (lower.includes("password should be")) {
      return "Password must be at least 8 characters long.";
    }
    // For all other auth errors, return a generic message.
    return "Sign up failed. Please check your details and try again.";
  }
}
