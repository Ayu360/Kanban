/**
 * AuthRepository — the repository interface for authentication.
 *
 * This is the swap seam (ADR-0004). The service layer depends on this
 * interface, not on SupabaseAuthRepository. Swapping the backend means
 * providing a new concrete implementation; nothing above this layer changes.
 *
 * Design rules:
 *   - All methods return domain types (Profile, etc.), never Supabase types.
 *   - All methods throw AppError on failure, never PostgrestError/AuthError.
 *   - Methods are async. No synchronous reads.
 *   - No Supabase imports in this file.
 */

import type {
  Profile,
  SignUpInput,
  SignInInput,
  ResetPasswordInput,
  UpdatePasswordInput,
  SignUpResult,
} from "../types";

export interface AuthRepository {
  /**
   * Creates a new auth.users row via Supabase Auth.
   * Does NOT create the profiles row — that is done by AuthService via
   * the create_profile_for_user RPC using the service-role client.
   *
   * Returns the new user's ID on success.
   * Throws AppError with code AUTH_EMAIL_ALREADY_IN_USE for duplicate emails,
   * AUTH_WEAK_PASSWORD for password policy violations, or UNKNOWN_ERROR otherwise.
   */
  createAuthUser(input: SignUpInput): Promise<{ userId: string; email: string }>;

  /**
   * Creates the profiles row for a new user by calling the
   * create_profile_for_user database RPC via the service-role client.
   *
   * The RPC is SECURITY DEFINER and handles the first-user-wins check
   * atomically (ADR-0014). Only the service-role client may invoke it.
   *
   * Throws AppError with code PROFILE_CREATE_FAILED or COMPANY_NOT_FOUND.
   */
  createProfile(params: {
    userId: string;
    companyId: string;
    displayName?: string;
  }): Promise<SignUpResult>;

  /**
   * Signs the user in and establishes a session cookie.
   * Throws AppError with code AUTH_INVALID_CREDENTIALS on failure.
   */
  signIn(input: SignInInput): Promise<Profile>;

  /**
   * Signs the current user out and clears the session cookie.
   * Throws AppError with code UNKNOWN_ERROR on unexpected failures.
   */
  signOut(): Promise<void>;

  /**
   * Sends a password reset email to the given address.
   * Always resolves — if the email is not found, Supabase Auth still returns
   * success (prevents email enumeration). Never throws for unknown emails.
   */
  sendPasswordResetEmail(input: ResetPasswordInput): Promise<void>;

  /**
   * Updates the current user's password.
   * Must be called from a session that was established via a password reset
   * link (the link sets a short-lived access token in the session).
   *
   * Throws AppError with code AUTH_TOKEN_INVALID if the session is invalid
   * or the reset link has been used or expired.
   */
  updatePassword(input: UpdatePasswordInput): Promise<void>;

  /**
   * Returns the current authenticated user's profile, or null if no session.
   * Reads the session from the server-side cookie, then fetches the profile row.
   *
   * Throws AppError with code PROFILE_NOT_FOUND if the user is authenticated
   * but no profile row exists (configuration/migration error).
   */
  getCurrentProfile(): Promise<Profile | null>;

  /**
   * Returns only the raw session (used by middleware for fast session check).
   * Does not fetch the profile row.
   *
   * Returns null if no session exists.
   */
  getSession(): Promise<{ userId: string; email: string | null } | null>;
}
