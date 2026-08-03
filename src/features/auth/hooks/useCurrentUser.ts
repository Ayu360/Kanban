"use client";

/**
 * useCurrentUser — TanStack Query hook for the current authenticated user's profile.
 *
 * This is the single hook all components use to access the current user's
 * identity and role. No component reads from authSlice or localStorage for
 * auth state (ADR-0012, FR-07).
 *
 * Query key: ['auth', 'profile']  (ADR-0013)
 * Backed by: getSupabaseBrowserClient().auth + profiles table query.
 *
 * Design:
 *   - Uses the browser Supabase client directly (not via a service class) because
 *     this hook runs in the browser. The service layer classes are server-only.
 *   - Reads the session via getUser() (not getSession()) — getUser() validates the
 *     JWT with Supabase Auth rather than just reading the cookie, preventing a
 *     stale/forged cookie from appearing valid.
 *   - Fetches the profile row once the session is confirmed.
 *   - Returns a stable { user, isLoading, error } shape (FR-07).
 *
 * staleTime: 5 minutes. The profile changes rarely. On mutation (role change,
 *   display name update), the relevant Server Action must call
 *   queryClient.invalidateQueries({ queryKey: ['auth', 'profile'] }).
 *
 * The hook does not redirect — redirection is the middleware's job (ADR-0011).
 */

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Profile, Role } from "../types";

/** Centralized query key for the current user's profile. ADR-0013. */
export const authQueryKeys = {
  profile: ["auth", "profile"] as const,
};

/**
 * Fetches the current user's profile from the browser.
 * Returns null if the user is not authenticated.
 */
async function fetchCurrentProfile(): Promise<Profile | null> {
  const supabase = getSupabaseBrowserClient();

  // getUser() validates the JWT server-side — does not trust the cookie alone.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, company_id, role, is_platform_admin, display_name, created_at, updated_at"
    )
    .eq("id", user.id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No profile row — authenticated user without a profile.
      // This is a configuration error but we return null here rather than
      // throwing, so the UI can handle it gracefully.
      return null;
    }
    throw new Error(`Failed to fetch profile: ${error.message}`);
  }

  if (!data) return null;

  const profile: Profile = {
    id: data.id,
    companyId: data.company_id,
    role: data.role as Role,
    isPlatformAdmin: data.is_platform_admin,
    displayName: data.display_name,
    email: user.email ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };

  return profile;
}

/**
 * Returns the current authenticated user's profile.
 *
 * Return shape (FR-07):
 *   { user: Profile | null, isLoading: boolean, error: Error | null }
 *
 * Usage:
 *   const { user, isLoading } = useCurrentUser();
 *   if (isLoading) return <Spinner />;
 *   if (!user) return null; // middleware should have redirected; defensive
 */
export function useCurrentUser(): {
  user: Profile | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery<Profile | null, Error>({
    queryKey: authQueryKeys.profile,
    queryFn: fetchCurrentProfile,
    staleTime: 5 * 60 * 1000, // 5 minutes — profile changes rarely
    retry: false,              // Don't retry auth errors — fail fast
  });

  return {
    user: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
