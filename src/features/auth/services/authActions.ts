"use server";

/**
 * Auth Server Actions — privileged authentication operations.
 *
 * Marked 'use server' — these run only on the server. The service-role
 * key (used by sign-up) never leaves the server boundary.
 *
 * ADR-0015: Signup (with first-user-wins bootstrap) and sign-out are
 *           implemented as Server Actions. Sign-in is also here so that
 *           the session cookie is set in a server response, not via a
 *           client-side supabase.auth.signIn call.
 *
 * Error contract:
 *   All actions return ActionResult<T> — a discriminated union.
 *   They NEVER throw. Callers switch on result.success to handle errors.
 *   This keeps error handling in the UI layer explicit and type-safe.
 *
 * Input validation:
 *   Each action validates its inputs before calling the service.
 *   This is backend validation — the frontend may also validate, but the
 *   backend is the authoritative gate (ADR-0003).
 *
 * Composition root:
 *   Actions import from container.ts to get the AuthService instance.
 *   They do not instantiate repositories or clients directly.
 */

import { redirect } from "next/navigation";
import type { ActionResult, SignUpResult } from "../types";
import { AppError } from "../types";
import {
  validateEmail,
  validatePassword,
  normalizeError,
} from "./authService";
import { getAuthService } from "@/lib/container";
import { isSafeRedirectPath } from "../utils/isSafeRedirectPath";

// ---------------------------------------------------------------------------
// signUpAction
// ---------------------------------------------------------------------------

/**
 * Creates a new user account and profile.
 *
 * Input validation is performed here before delegating to AuthService.
 * The first-user-wins check runs inside the create_profile_for_user RPC
 * (atomically, with an advisory lock — ADR-0014).
 *
 * On success: the caller (form action handler / hook) redirects to the
 * default post-login page. We return the profile so the caller can use
 * it if needed (e.g. different redirect for admin vs employee in the future).
 *
 * We do NOT redirect inside this Server Action — redirects are a UI concern.
 * The action returns a typed result; the UI layer decides where to navigate.
 */
export async function signUpAction(formData: FormData): Promise<ActionResult<SignUpResult>> {
  const email = (formData.get("email") as string | null) ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  const displayName = (formData.get("displayName") as string | null) ?? undefined;

  // Backend input validation.
  const emailError = validateEmail(email);
  if (emailError) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: emailError } };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: passwordError } };
  }

  try {
    const authService = getAuthService();
    const result = await authService.signUp({
      email: email.trim(),
      password,
      displayName: displayName?.trim() || undefined,
    });

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
// signInAction
// ---------------------------------------------------------------------------

/**
 * Authenticates an existing user and establishes the session cookie.
 *
 * The login form calls this action. The session cookie is set server-side
 * in the response (via @supabase/ssr cookie helpers), so no client-side
 * Supabase call is needed and the cookie is HTTP-only.
 *
 * Returns the authenticated profile. On error, returns a generic
 * "Invalid email or password" message regardless of the actual cause
 * (prevents user enumeration, FR-02).
 */
export async function signInAction(formData: FormData): Promise<ActionResult<{ redirectTo: string }>> {
  const email = (formData.get("email") as string | null) ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  const redirectTo = (formData.get("redirectTo") as string | null) ?? "/kanban";

  // Backend input validation.
  const emailError = validateEmail(email);
  if (emailError) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: emailError } };
  }

  if (!password) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Password is required." },
    };
  }

  try {
    const authService = getAuthService();
    await authService.signIn({ email: email.trim(), password });

    // Validate the redirect path: only allow relative paths to prevent open redirect.
    const safeRedirectTo = isSafeRedirectPath(redirectTo) ? redirectTo : "/kanban";

    return { success: true, data: { redirectTo: safeRedirectTo } };
  } catch (error) {
    const appError = normalizeError(error);
    // H-4 fix: return the same generic message for ALL sign-in failures, not
    // just AUTH_INVALID_CREDENTIALS. This prevents error-message enumeration
    // where an attacker could distinguish "wrong password" from "server error"
    // by reading the message text. The code field is preserved so the frontend
    // can still branch programmatically (e.g. to show a retry hint) without
    // exposing the underlying failure reason to the user.
    return {
      success: false,
      error: {
        code: appError.code,
        message: "Invalid email or password. Please check your credentials and try again.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// signOutAction
// ---------------------------------------------------------------------------

/**
 * Signs the current user out and redirects to /login.
 *
 * This action uses redirect() after clearing the session, so it DOES
 * redirect (unlike sign-up and sign-in which return a result).
 * The redirect is the only appropriate response to a sign-out — there is
 * no data to return, and the user must see the login page.
 *
 * Callers: form actions with method="post" pointing to this Server Action,
 * or useMutation hooks that call the action then handle navigation.
 *
 * Note on redirect(): Next.js redirect() throws a special error internally.
 * It must not be wrapped in a try/catch that swallows all errors.
 */
export async function signOutAction(): Promise<never> {
  try {
    const authService = getAuthService();
    await authService.signOut();
  } catch {
    // If sign-out fails (e.g. session already cleared), we still redirect.
    // A failed sign-out should not leave the user stuck on a protected page.
  }

  redirect("/login");
}

// ---------------------------------------------------------------------------
// resetPasswordAction
// ---------------------------------------------------------------------------

/**
 * Sends a password reset email.
 * Always returns success — never reveals whether the email is registered (FR-05).
 */
export async function resetPasswordAction(
  formData: FormData
): Promise<ActionResult<{ sent: true }>> {
  const email = (formData.get("email") as string | null) ?? "";

  const emailError = validateEmail(email);
  if (emailError) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: emailError } };
  }

  try {
    const authService = getAuthService();
    await authService.sendPasswordResetEmail({ email: email.trim() });
    return { success: true, data: { sent: true } };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// updatePasswordAction
// ---------------------------------------------------------------------------

/**
 * Sets a new password from a password reset link session.
 *
 * Called from the /reset-password/confirm page after Supabase Auth has
 * exchanged the reset token for a session (via the URL hash).
 *
 * On success, the caller redirects to /login.
 * On failure, returns an error for the UI to display.
 */
export async function updatePasswordAction(
  formData: FormData
): Promise<ActionResult<{ updated: true }>> {
  const password = (formData.get("password") as string | null) ?? "";

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: passwordError } };
  }

  try {
    const authService = getAuthService();
    await authService.updatePassword({ password });
    return { success: true, data: { updated: true } };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}
