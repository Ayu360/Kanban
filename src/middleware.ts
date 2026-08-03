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
