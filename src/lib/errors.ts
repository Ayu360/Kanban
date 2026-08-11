/**
 * Shared error utilities.
 *
 * Centralizes `normalizeError` so that all Server Action catch blocks
 * (auth, teams, and future features) use a single implementation.
 *
 * The UNKNOWN_ERROR branch uses a fixed generic client-facing message to
 * avoid leaking internal error details to the client. The original error
 * is retained as the AppError cause so server-side log inspection can
 * recover the full stack / message.
 */

import { AppError } from "@/features/auth/types";

/**
 * Normalizes an unknown thrown value into a typed AppError.
 *
 * - If the value is already an AppError, it is returned as-is.
 * - If it is a standard Error, the original is stored as the cause
 *   but the client-facing message is a fixed safe string.
 * - Any other thrown value (string, object) is wrapped similarly.
 *
 * The original error is always preserved as `cause` so server-side
 * tooling can inspect the full details without exposing them to clients.
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(
      "UNKNOWN_ERROR",
      "An unexpected error occurred. Please try again.",
      error
    );
  }
  return new AppError(
    "UNKNOWN_ERROR",
    "An unexpected error occurred. Please try again.",
    error
  );
}
