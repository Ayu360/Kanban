/**
 * PKCE Auth Callback Route Handler — C-2 fix.
 *
 * Supabase Auth password reset (and OAuth, if added later) uses PKCE:
 * the email link points to this route with a `code` query parameter instead
 * of putting a session token directly in the URL.
 *
 * This handler:
 *   1. Reads `code` from the query string.
 *   2. Exchanges the code for a session server-side via
 *      supabase.auth.exchangeCodeForSession(). This writes the HTTP-only
 *      session cookie onto the response.
 *   3. Reads the `next` query param (validated for safety) and redirects
 *      there on success — default is /reset-password/confirm.
 *   4. On failure, redirects to /login?error=auth_callback_failed.
 *
 * IMPORTANT for the frontend:
 *   The frontend MUST NOT call supabase.auth.exchangeCodeForSession() itself.
 *   The session is already established by the time the user lands on `next`.
 *   updatePasswordAction() can be called directly on /reset-password/confirm.
 *
 * Route: GET /api/auth/callback?code=<code>[&next=<path>]
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
// Reuse the safe-redirect guard from authActions — single source of truth.
import { isSafeRedirectPath } from "@/features/auth/services/authActions";

/** Default page to land on after a successful code exchange. */
const DEFAULT_NEXT_PATH = "/reset-password/confirm";

/** Redirect target when the code exchange fails. */
const FAILURE_REDIRECT = "/login?error=auth_callback_failed";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? DEFAULT_NEXT_PATH;

  // Validate the `next` redirect path using the shared guard.
  // Falls back to the default if the supplied path is unsafe.
  const next = isSafeRedirectPath(nextParam) ? nextParam : DEFAULT_NEXT_PATH;

  if (!code) {
    // No code present — this is not a valid PKCE callback. Redirect to failure.
    return NextResponse.redirect(new URL(FAILURE_REDIRECT, origin));
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Exchange failed (code expired, already used, etc.).
      // Redirect to login with a generic error param so the frontend can
      // display a prompt to request a new reset email.
      return NextResponse.redirect(new URL(FAILURE_REDIRECT, origin));
    }

    // Success — redirect to the intended destination (e.g. /reset-password/confirm).
    // The session cookie is now set on the response by @supabase/ssr.
    return NextResponse.redirect(new URL(next, origin));
  } catch {
    // Unexpected error during exchange — fail safe.
    return NextResponse.redirect(new URL(FAILURE_REDIRECT, origin));
  }
}
