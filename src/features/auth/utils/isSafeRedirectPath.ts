/**
 * Validates that a redirect path is a safe relative path.
 * Prevents open redirect attacks where an attacker passes an absolute URL
 * as the redirectTo parameter.
 *
 * Allowed: relative paths starting with /
 * Rejected: absolute URLs, protocol-relative URLs, data: URIs, etc.
 *
 * Kept outside authActions.ts because that file is marked "use server",
 * and Next.js requires every export from a Server Actions module to be async.
 */
export function isSafeRedirectPath(path: string): boolean {
  // Must start with / but not // (protocol-relative).
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  // Must not contain a colon (catches http:, https:, javascript:, data:, etc.)
  if (path.includes(":")) return false;
  // Block auth routes to prevent redirect loops.
  if (path === "/login" || path === "/signup" || path === "/reset-password") return false;
  return true;
}
