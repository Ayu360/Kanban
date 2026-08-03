/**
 * Server-side Supabase client factories.
 *
 * Two factories live here:
 *   1. getSupabaseServerClient()       — anon key + cookie session. Respects RLS.
 *                                        Use for Server Components, route handlers,
 *                                        and ordinary Server Actions.
 *   2. getSupabaseServiceRoleClient()  — service-role key. Bypasses RLS entirely.
 *                                        Use ONLY for privileged Server Actions
 *                                        (signup bootstrap, role changes). Never
 *                                        in components or ordinary data reads.
 *
 * Both factories MUST be called inside a server context (Server Component,
 * Server Action, middleware). Never import this file from a 'use client' module.
 *
 * Cookie management:
 *   @supabase/ssr's createServerClient expects an adapter that reads/writes
 *   Next.js request cookies. The adapter is created lazily per-request so that
 *   each request has its own isolated cookie context. Do NOT share a single
 *   server client instance across requests.
 */

// C-4: server-only guard — Next.js throws a build-time error if this file
// is imported (directly or transitively) in any client bundle.
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
// C-4: public vars come from env.public.ts (browser-safe); the service-role
// key comes from env.server.ts (server-only, enforced by 'server-only' import).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env.public";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/env.server";

/**
 * Creates a per-request server Supabase client using the public anon key.
 * Reads and refreshes the session cookie from Next.js headers.
 * This client respects RLS — use it for all ordinary data access.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll may throw in Server Components (read-only context).
          // Middleware handles cookie writes; this is a no-op when called
          // from a Server Component that cannot write headers.
        }
      },
    },
  });
}

/**
 * Creates a per-request server Supabase client using the service-role key.
 * This client BYPASSES RLS entirely.
 *
 * Use only when the operation explicitly requires bypassing RLS:
 *   - Signup profile creation via create_profile_for_user RPC
 *   - Role / is_platform_admin mutations
 *
 * The service-role client does NOT carry a user session. It acts as a
 * superuser. Keep its usage surface minimal and auditable.
 *
 * Never expose this function's return value to client code.
 */
export function getSupabaseServiceRoleClient() {
  // Service-role client does not need cookie management — it authenticates
  // via the key itself, not via a user session cookie.
  return createServerClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Service-role client never sets cookies.
      },
    },
    auth: {
      // Disable automatic session persistence for service-role.
      // This client is stateless per-call.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
