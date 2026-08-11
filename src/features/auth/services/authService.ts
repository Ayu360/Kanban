/**
 * AuthService — business logic layer for authentication.
 *
 * Orchestrates repository calls, enforces business rules, and is the single
 * place where domain-level decisions are made (which company to assign,
 * first-user-wins semantics, error presentation strategy).
 *
 * This service is UI-agnostic and testable in isolation by mocking
 * the AuthRepository interface.
 *
 * ADR-0014: The first-user-wins check is performed atomically in the
 * database (create_profile_for_user RPC). AuthService calls the repository
 * method that invokes that RPC — the atomicity guarantee lives in the DB.
 *
 * ADR-0006: All profiles are scoped to the default company UUID in MVP.
 * This constant is defined here — the single place to update if the
 * company provisioning model changes.
 */

import type { AuthRepository } from "../repositories/AuthRepository";
import type {
  SignUpInput,
  SignInInput,
  ResetPasswordInput,
  UpdatePasswordInput,
  SignUpResult,
  Profile,
} from "../types";
import { AppError } from "../types";
export { normalizeError } from "@/lib/errors";

/**
 * The default (and only, for MVP) company UUID.
 * Matches the seed row in migration 20260802000001_auth_schema.sql.
 * ADR-0006: Every user in the MVP belongs to this company.
 */
export const DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  /**
   * Signs up a new user.
   *
   * Flow (ADR-0015, ADR-0014):
   *   1. Create the auth.users row via Supabase Auth.
   *   2. Call create_profile_for_user RPC (service-role) to atomically insert
   *      the profile with the correct role (first-user-wins or employee).
   *   3. Return the new profile so callers can make redirect decisions.
   *
   * If step 1 succeeds but step 2 fails, the auth.users row exists without a
   * corresponding profile. This is a transient inconsistency. The user can
   * attempt sign up again — the RPC's ON CONFLICT DO NOTHING makes it idempotent.
   * The auth.users row is harmless without a profile (RLS will reject all
   * profile reads for that user).
   */
  async signUp(input: SignUpInput): Promise<SignUpResult> {
    // Step 1: create auth user.
    // Note: supabase.auth.signUp() establishes a session in email-confirmed
    // projects, but does NOT reliably set the session cookie server-side via
    // @supabase/ssr when called from a Server Action. The session returned by
    // signUp is discarded by createAuthUser — we re-establish it below (Step 3).
    const { userId } = await this.repo.createAuthUser(input);

    // Step 2: create profile row (first-user-wins check inside RPC).
    const result = await this.repo.createProfile({
      userId,
      companyId: DEFAULT_COMPANY_ID,
      displayName: input.displayName,
    });

    // Step 3 (C-3 fix — Approach A: auto-confirm / no email verification):
    // After profile creation succeeds, sign the user in immediately so that
    // the HTTP-only session cookie is written into the server response.
    // Without this step the middleware sees no session on the next request
    // and redirects the newly-signed-up user back to /login.
    //
    // PRD FR-01: "On successful signup … the user is redirected to the main
    // application." That redirect only works if a session exists. This call
    // is what makes it possible.
    //
    // If Supabase Auth is configured with email confirmation enabled (Approach B),
    // this signIn will fail because the email is unconfirmed. In that case:
    //   1. Remove this signIn call.
    //   2. Change SignUpResult to a discriminated union with an
    //      emailConfirmationRequired branch.
    //   3. Document the change in the frontend handoff doc.
    await this.repo.signIn({ email: input.email, password: input.password });

    return result;
  }

  /**
   * Signs in an existing user and establishes the session cookie.
   * Returns the user's profile for immediate use.
   */
  async signIn(input: SignInInput): Promise<Profile> {
    return this.repo.signIn(input);
  }

  /**
   * Signs the current user out and clears the session cookie.
   */
  async signOut(): Promise<void> {
    return this.repo.signOut();
  }

  /**
   * Sends a password reset email.
   * Always returns success to prevent email enumeration (FR-05).
   */
  async sendPasswordResetEmail(input: ResetPasswordInput): Promise<void> {
    return this.repo.sendPasswordResetEmail(input);
  }

  /**
   * Updates the user's password from a reset-link session.
   */
  async updatePassword(input: UpdatePasswordInput): Promise<void> {
    return this.repo.updatePassword(input);
  }

  /**
   * Returns the current user's profile, or null if unauthenticated.
   * Used by useCurrentUser() hook via TanStack Query.
   */
  async getCurrentProfile(): Promise<Profile | null> {
    return this.repo.getCurrentProfile();
  }

  /**
   * Returns a lightweight session check result (userId only).
   * Used by middleware for fast authentication gating before page render.
   */
  async getSession(): Promise<{ userId: string; email: string | null } | null> {
    return this.repo.getSession();
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (used by Server Actions before calling the service)
// ---------------------------------------------------------------------------

/**
 * Email validation: basic format check.
 * Supabase Auth enforces the real constraint server-side; this is UX.
 * We also validate here so Server Actions reject bad input before a round-trip.
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Email address is required.";
  // Standard email pattern — not exhaustive but catches obvious typos.
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(trimmed)) return "Please enter a valid email address.";
  return null;
}

/**
 * Password validation: minimum 8 characters (FR-01, FR-06).
 * Supabase Auth enforces this via its password policy config.
 * We validate here so Server Actions fail fast with a clear message.
 */
export function validatePassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters long.";
  return null;
}

// normalizeError is re-exported from @/lib/errors (shared utility).
// The definition has been extracted there to eliminate the duplicate that
// existed between authService.ts and teamsService.ts.
