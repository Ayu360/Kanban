/**
 * Domain DTOs for the auth feature.
 *
 * These types cross the repository boundary and are the canonical shape
 * that services, hooks, and components consume. No Supabase-specific types
 * appear here — the repository layer normalizes them before returning.
 *
 * ADR-0004: Supabase types must not leak past the repository boundary.
 * ADR-0007: role lives in profiles, not Supabase Auth user metadata.
 * ADR-0008: is_platform_admin and role are orthogonal flags.
 */

/** Company-scoped role. Constrained by a DB CHECK constraint. */
export type Role = "admin" | "employee";

/**
 * The authenticated user's application profile.
 * Maps 1:1 to a row in public.profiles.
 */
export interface Profile {
  id: string;
  companyId: string;
  role: Role;
  isPlatformAdmin: boolean;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for signing up a new user.
 */
export interface SignUpInput {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Input for signing in.
 */
export interface SignInInput {
  email: string;
  password: string;
}

/**
 * Input for requesting a password reset email.
 */
export interface ResetPasswordInput {
  email: string;
}

/**
 * Input for setting a new password (from reset confirmation link).
 */
export interface UpdatePasswordInput {
  password: string;
}

/**
 * Result of a successful signup.
 * Includes the profile row that was created so callers can make routing
 * decisions without an extra round-trip.
 */
export interface SignUpResult {
  profile: Profile;
}

/**
 * Normalized project error type.
 *
 * Supabase-specific error details (PostgrestError, AuthError) are caught at
 * the repository layer and re-thrown as AppError. Nothing above the
 * repository sees Supabase internals (ADR-0004).
 */
export type AppErrorCode =
  // Auth-specific codes
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_EMAIL_ALREADY_IN_USE"
  | "AUTH_WEAK_PASSWORD"
  | "AUTH_USER_NOT_FOUND"
  | "AUTH_SESSION_MISSING"
  | "AUTH_TOKEN_INVALID"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_CREATE_FAILED"
  | "COMPANY_NOT_FOUND"
  // Generic codes reused across features
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "CROSS_COMPANY"
  | "UNKNOWN_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "AppError";
    // Maintain proper stack trace in V8.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

/**
 * The result of a Server Action — a discriminated union that callers
 * can exhaustively switch over without try/catch.
 *
 * Server Actions must not throw — they return a typed result instead.
 * This keeps the error contract machine-readable and avoids React's
 * unhandled-error boundary being triggered by expected failures.
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: AppErrorCode; message: string } };
