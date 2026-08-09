/**
 * Public environment variables — safe to import in both browser and server bundles.
 *
 * Only NEXT_PUBLIC_* variables live here. Nothing in this file is sensitive.
 * This module is deliberately NOT guarded by 'server-only' so that Client
 * Components and the browser Supabase client can import it safely.
 *
 * C-4 fix: split from env.ts to prevent the service-role key from being
 * bundled into the browser via env.ts → browser.ts import chain.
 *
 * IMPORTANT: values must be read via static `process.env.NEXT_PUBLIC_*`
 * property access (not `process.env[name]`). Next.js / Turbopack only
 * inlines NEXT_PUBLIC_ vars into the client bundle when the key is a
 * compile-time literal.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Ensure it is set in your .env.local (development) or Vercel environment variables (production)."
    );
  }
  return value;
}

/** Supabase project URL. Safe to expose to the browser. */
export const SUPABASE_URL = requireEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

/** Supabase public anon key. Safe to expose to the browser. */
export const SUPABASE_ANON_KEY = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
