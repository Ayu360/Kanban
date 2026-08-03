/**
 * Server-only environment variables.
 *
 * The 'server-only' import causes Next.js to throw a build-time error if this
 * file is transitively imported by any client bundle. This is the enforcement
 * mechanism that prevents the service-role key from leaking to the browser.
 *
 * C-4 fix: split from env.ts so browser.ts can import env.public.ts without
 * also pulling in the service-role key.
 *
 * H-2 fix: APP_URL is validated here rather than read with a localhost fallback
 * inside sendPasswordResetEmail. A missing APP_URL fails loudly at startup.
 */

import "server-only";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Ensure it is set in your .env.local (development) or Vercel environment variables (production)."
    );
  }
  return value;
}

/**
 * Supabase service-role key.
 *
 * SERVER-ONLY. This key bypasses RLS entirely.
 * Never import this file from a 'use client' module or any browser bundle.
 * Enforcement: Next.js build fails if this module reaches a client bundle.
 */
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

/**
 * Application base URL (e.g. https://myapp.vercel.app in prod, http://localhost:3000 in dev).
 *
 * Used by SupabaseAuthRepository.sendPasswordResetEmail to construct the
 * absolute redirectTo URL. Server-only because it is only ever needed
 * server-side and having it validated once here prevents the localhost
 * fallback anti-pattern.
 *
 * Set this to NEXT_PUBLIC_APP_URL in your .env.local / Vercel env vars.
 * H-2 fix: no localhost fallback — misconfiguration fails loudly.
 */
export const APP_URL = requireEnv("NEXT_PUBLIC_APP_URL");
