/**
 * Next.js Middleware — session enforcement and cookie refresh.
 *
 * ADR-0011: This middleware is the single point of session enforcement.
 * It runs on the server before any page renders, so:
 *   - Unauthenticated users are redirected before protected content renders.
 *   - No flash of protected content.
 *   - JavaScript-disabled clients cannot bypass auth.
 *
 * Responsibilities:
 *   1. Refresh the Supabase session cookie on every matched request (keeps
 *      sessions alive for active users, handles token rotation).
 *   2. Redirect unauthenticated users to /login?redirect=<path>.
 *   3. Redirect authenticated users away from auth pages (/login, /signup)
 *      to prevent a confusing re-login experience (Edge Case 6 in PRD).
 *
 * Public routes (no auth required):
 *   /              — landing page
 *   /login         — login page
 *   /signup        — signup page
 *   /how-it-works  — informational page
 *   /reset-password        — password reset request
 *   /reset-password/confirm — password reset confirmation
 *
 * The matcher excludes static assets and Next.js internals so middleware
 * does not run on every asset request (performance, ADR-0011).
 *
 * Note: getUser() is used here (not getSession()) because it validates the
 * JWT with Supabase rather than trusting the cookie alone. This is the
 * recommended pattern from @supabase/ssr for middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// H-1: Fail-fast guard for required env vars.
// NOTE: We deliberately read process.env directly here rather than importing
// from env.public.ts because middleware runs in the Edge runtime, where
// module-level code that accesses process.env can behave differently from
// the Node.js runtime. Inline guards with explanatory comments are safer and
// keep the middleware dependency graph minimal (no extra module boundary).
// If env.public.ts is ever verified to be fully Edge-compatible, this can
// be replaced with an import.
const _supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const _supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!_supabaseUrl || !_supabaseAnonKey) {
  throw new Error(
    "Middleware startup failure: NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. " +
      "Check your .env.local (development) or Vercel environment variables (production)."
  );
}

const SUPABASE_URL = _supabaseUrl;
const SUPABASE_ANON_KEY = _supabaseAnonKey;

/** Routes that do not require authentication. */
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/how-it-works",
  "/reset-password",
  "/reset-password/confirm",
  // C-2: The PKCE callback route must be public — the user clicking the
  // password reset email link is unauthenticated when they arrive here.
  "/api/auth/callback",
  // Invite-acceptance callback — the invited user arrives here unauthenticated
  // or with a fresh session immediately after accepting the magic link.
  // The page calls activateInvitedEmployeeAction to transition pending → active.
  "/api/auth/invite-callback",
]);

/**
 * Routes where a 'pending' user IS allowed to proceed.
 * The invite-acceptance callback page and its API route must be reachable
 * even if the invited user's JWT carries status='pending'.
 *
 * NOTE: This set contains ONLY routes a pending user legitimately needs.
 * Do not add application routes here — pending users should not access the app.
 */
const PENDING_ALLOWED_PATHS = new Set([
  "/api/auth/invite-callback",
  "/accept-invite",
]);

/** Auth routes: redirect to app if the user is already authenticated. */
const AUTH_ONLY_PATHS = new Set(["/login", "/signup", "/reset-password"]);

/** Default route after successful login. */
const DEFAULT_POST_LOGIN_PATH = "/kanban";

function isPublicPath(pathname: string): boolean {
  // Exact match or prefix match for paths in the public set.
  return PUBLIC_PATHS.has(pathname);
}

function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_PATHS.has(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Create a mutable response so we can pass it to the Supabase client
  // for cookie mutation (session refresh).
  let supabaseResponse = NextResponse.next({ request });

  // Build the Supabase server client with cookie adapter.
  // This MUST use createServerClient directly (not our factory) because
  // middleware has a different cookie API than Server Components.
  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // First, write cookies back onto the request for downstream
          // server code that reads them in the same lifecycle.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Recreate the response with the updated request cookies.
          supabaseResponse = NextResponse.next({ request });
          // Then write cookies onto the response so the browser receives them.
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not write application logic between createServerClient and
  // getUser(). The getUser() call is what triggers the cookie refresh.
  // Any code that creates a new response between these two calls will break
  // the session cookie update.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthenticated = !!user;

  // -------------------------------------------------------------------------
  // Status claim checks (Employees module — JWT hook adds `status` to app_metadata)
  // -------------------------------------------------------------------------
  // These checks run BEFORE the auth-only and public-path guards so that a
  // deactivated or pending user with a valid session cannot access the app.
  //
  // The `status` claim is written by the custom_access_token_hook (DB migration
  // 20260816000002). It reflects the profiles.status column:
  //   'active'      — normal user, allow through
  //   'pending'     — invited but not yet accepted (should not have a valid
  //                   session in normal flow — guard defensively per handoff)
  //   'deactivated' — admin-deactivated, block immediately
  //
  // JWT staleness window: After deactivate_employee, the target's JWT remains
  // valid until its next refresh (~1 hour) UNLESS the Server Action also called
  // auth.admin.banUser (which revokes the session). The status='deactivated'
  // check here provides the final safety net for the JWT-refresh path.
  if (isAuthenticated && user) {
    // Read the status claim set by the custom_access_token_hook.
    // Using typeof guard rather than a cast — app_metadata values are unknown
    // at runtime. If the claim is absent (pre-hook JWT or profile-not-found
    // race), status is undefined and the strict equality checks below fall
    // through without blocking the request.
    const rawStatus = user.app_metadata?.status;
    const status = typeof rawStatus === "string" ? rawStatus : undefined;

    // Case: deactivated user with an active session (possible during the
    // 1-hour JWT staleness window if the Auth ban did not fire or failed).
    // Sign them out and redirect to login with an error indicator.
    if (status === "deactivated") {
      // Sign out to clear the session cookie so they cannot retry.
      await supabase.auth.signOut();

      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("error", "deactivated");
      return NextResponse.redirect(redirectUrl);
    }

    // Case: pending user accessing a non-invite-acceptance route.
    // In normal flow, Supabase Auth does not establish a session until the
    // invite is accepted — this branch is a defensive guard for edge cases.
    if (status === "pending" && !PENDING_ALLOWED_PATHS.has(pathname)) {
      // Do NOT sign out — the pending user needs their session to call
      // activate_invited_employee from the invite-acceptance callback.
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("error", "pending");
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Case 1: Authenticated user visiting an auth-only page (e.g. /login, /signup).
  // Redirect to the app so they don't see the login form again (PRD Edge Case 6).
  if (isAuthenticated && isAuthOnlyPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = DEFAULT_POST_LOGIN_PATH;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  // Case 2: Unauthenticated user visiting a protected route.
  // Redirect to /login?redirect=<original-path> (FR-04, PRD Edge Case 5).
  if (!isAuthenticated && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Case 3: Pass through — return the response with any refreshed cookies.
  // This is the happy path for both authenticated users on protected routes
  // and unauthenticated users on public routes.
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static  (Next.js static files)
     *   - _next/image   (Next.js image optimization)
     *   - favicon.ico   (favicon)
     *   - /assets/*     (public assets)
     *   - Files with extensions (images, fonts, etc.)
     *
     * The negative lookahead (?!_next|...) is the standard @supabase/ssr
     * middleware pattern.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf)$).*)",
  ],
};
