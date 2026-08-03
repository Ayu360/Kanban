"use client";

/**
 * Browser-side Supabase client factory.
 *
 * Uses the public anon key with cookie-based session storage managed by
 * @supabase/ssr. This client respects RLS and is safe for use in Client
 * Components and browser-side hooks.
 *
 * NEVER import the service-role key here. NEVER use this client in a
 * Server Component, Server Action, or middleware file.
 *
 * Singleton pattern: createBrowserClient() from @supabase/ssr already
 * deduplicates across calls when the env vars are stable, but we wrap it
 * in a module-level singleton to keep the reference stable within a render.
 */

import { createBrowserClient } from "@supabase/ssr";
// C-4: import from env.public.ts (no server-only guard) so that this browser
// client module never transitively pulls in the service-role key.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env.public";

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Returns the singleton browser Supabase client.
 * Safe to call multiple times — always returns the same instance.
 */
export function getSupabaseBrowserClient() {
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
