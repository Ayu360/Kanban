// C-4: server-only guard — this module is the composition root and must never
// be imported from a client bundle. The service and repository classes
// reference server.ts which also has this guard, providing defense-in-depth.
import "server-only";

/**
 * Composition root — wires concrete repository implementations to the
 * service layer.
 *
 * ADR-0004: Nothing above the repository layer knows which backend is in
 * use. The service layer depends on repository *interfaces*. This file is the
 * only place where the concrete implementations are chosen.
 *
 * To swap Supabase for a Node.js backend:
 *   1. Create NodeAuthRepository / NodeTeamsRepository implementing the interfaces.
 *   2. Change the imports below.
 *   3. Nothing else in the codebase changes.
 *
 * Server-only: this file is imported only from Server Actions and server
 * modules. Client components import hooks, not services or repositories.
 *
 * Singletons: service and repository instances are module-level singletons.
 * This is safe — they are stateless (all state is in the Supabase client
 * factory, which is per-request). A new repository instance per request
 * would also be correct; the singleton here avoids unnecessary allocation.
 */

import { SupabaseAuthRepository } from "@/features/auth/repositories/SupabaseAuthRepository";
import { AuthService } from "@/features/auth/services/authService";
import { SupabaseTeamsRepository } from "@/features/teams/repositories/SupabaseTeamsRepository";
import { TeamsService } from "@/features/teams/services/teamsService";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Concrete implementation selection.
// To swap backends: change this import and the constructor argument below.
const authRepository = new SupabaseAuthRepository();

// Service instance — depends on the interface, not the implementation.
const authService = new AuthService(authRepository);

/**
 * Returns the singleton AuthService.
 * Call this from Server Actions and server-side code.
 * Do not call this from Client Components or browser hooks.
 */
export function getAuthService(): AuthService {
  return authService;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

// Concrete implementation selection.
// To swap backends: change this import and the constructor argument below.
const teamsRepository = new SupabaseTeamsRepository();

// Service instance — depends on TeamsRepository interface, not the implementation.
const teamsService = new TeamsService(teamsRepository);

/**
 * Returns the singleton TeamsService.
 * Call this from Server Actions and server-side code.
 * Do not call this from Client Components or browser hooks.
 */
export function getTeamsService(): TeamsService {
  return teamsService;
}
