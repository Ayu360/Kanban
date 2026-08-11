"use server";

/**
 * Teams Server Actions — privileged team management operations.
 *
 * Marked 'use server' — these run only on the server. The service-role key
 * (used by delete) never leaves the server boundary.
 *
 * ADR-0015: Team creation, deletion, and member management are privileged
 * operations that must be Server Actions. Rename is a Server Action too
 * for consistency and future-proofing.
 *
 * Error contract:
 *   All actions return ActionResult<T> — a discriminated union.
 *   They NEVER throw. Callers switch on result.success to handle errors.
 *   This keeps error handling in the UI layer explicit and type-safe.
 *
 * Security contract:
 *   - Caller identity is ALWAYS derived from the authenticated session
 *     (via the auth repository / getCurrentProfile). It is NEVER accepted
 *     from the client as a parameter.
 *   - companyId for deleteTeamAction is derived from the caller's JWT via
 *     the service layer. Clients cannot supply it.
 *   - If no session exists, actions return UNAUTHENTICATED immediately.
 *
 * Composition root:
 *   Actions import from container.ts to get TeamsService.
 *   They do not instantiate repositories or clients directly.
 *
 * RPC contract (C-1 security fix):
 *   createTeamAction calls create_team_with_board with ONLY { p_company_id, p_name }.
 *   p_caller_id is NOT passed — the RPC derives identity from auth.uid() internally.
 */

import type { ActionResult, Team, CreateTeamResult } from "../types";
import { AppError } from "../types";
import { normalizeError } from "./teamsService";
import { getTeamsService } from "@/lib/container";
import { getAuthService } from "@/lib/container";

// ---------------------------------------------------------------------------
// Private helper: get the authenticated caller's profile
// ---------------------------------------------------------------------------

/**
 * Loads the current caller's profile from the server session.
 * Returns null if there is no authenticated session.
 *
 * Uses the AuthService's getCurrentProfile() which reads the session cookie
 * and fetches the profile row — the same pattern used by authActions.ts.
 */
async function getCallerProfile() {
  const authService = getAuthService();
  return authService.getCurrentProfile();
}

// ---------------------------------------------------------------------------
// createTeamAction
// ---------------------------------------------------------------------------

/**
 * Creates a new team (with board + seeded columns) atomically.
 *
 * Authorization: platform admin OR company admin.
 * The caller's company_id is derived from their session, not from the client.
 *
 * Input:
 *   companyId — the company to create the team in. For company admins, this
 *               must match their JWT company_id (service enforces this).
 *               For platform admins, any valid company UUID is accepted.
 *   name      — the team name (trimmed, non-empty, max 100 chars).
 *
 * Returns: CreateTeamResult { teamId, boardId }
 *
 * CRITICAL: The RPC is called with ONLY { p_company_id, p_name }.
 * p_caller_id is NOT passed (C-1 security fix — see SupabaseTeamsRepository).
 */
export async function createTeamAction(input: {
  companyId: string;
  name: string;
}): Promise<ActionResult<CreateTeamResult>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to create a team.",
        },
      };
    }

    const teamsService = getTeamsService();
    const result = await teamsService.createTeam(input, caller);
    return { success: true, data: result };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// renameTeamAction
// ---------------------------------------------------------------------------

/**
 * Renames a team.
 *
 * Authorization: platform admin OR company admin (for teams within their company).
 * The service fetches the team to verify company-scope for company admins.
 *
 * Returns the updated Team record.
 */
export async function renameTeamAction(
  teamId: string,
  name: string
): Promise<ActionResult<Team>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to rename a team.",
        },
      };
    }

    const teamsService = getTeamsService();
    const team = await teamsService.renameTeam(teamId, name, caller);
    return { success: true, data: team };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// deleteTeamAction
// ---------------------------------------------------------------------------

/**
 * Deletes a team and all cascade-linked data (board, columns, team_members).
 *
 * Authorization: platform admin OR company admin.
 *
 * SECURITY: The caller's company_id is derived from the authenticated session
 * by the service layer, then passed to the repository for the mandatory
 * service-role company-scoping filter. The client does NOT supply companyId.
 *
 * Platform admins: the service fetches the team to determine its company_id
 * before calling the repository.
 *
 * This action does NOT accept companyId as a parameter — doing so would allow
 * a malicious client to influence the scope of the service-role delete.
 */
export async function deleteTeamAction(
  teamId: string
): Promise<ActionResult<void>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to delete a team.",
        },
      };
    }

    const teamsService = getTeamsService();
    await teamsService.deleteTeam(teamId, caller);
    return { success: true, data: undefined };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// addTeamMemberAction
// ---------------------------------------------------------------------------

/**
 * Adds a profile to a team.
 *
 * Authorization: platform admin OR company admin.
 * Cross-company protection is enforced by the DB trigger (check_violation 23514),
 * mapped by the repository to AppErrorCode.CROSS_COMPANY.
 *
 * Idempotent: adding an already-existing member is a no-op (ON CONFLICT DO NOTHING).
 */
export async function addTeamMemberAction(
  teamId: string,
  profileId: string
): Promise<ActionResult<void>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to manage team members.",
        },
      };
    }

    const teamsService = getTeamsService();
    await teamsService.addTeamMember(teamId, profileId, caller);
    return { success: true, data: undefined };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}

// ---------------------------------------------------------------------------
// removeTeamMemberAction
// ---------------------------------------------------------------------------

/**
 * Removes a profile from a team.
 *
 * Authorization: platform admin OR company admin.
 * Idempotent: removing a non-member is a no-op.
 *
 * Access is revoked immediately at the next RLS-evaluated query from the
 * removed member — no server-side cache invalidation is needed (ADR-0009).
 */
export async function removeTeamMemberAction(
  teamId: string,
  profileId: string
): Promise<ActionResult<void>> {
  try {
    const caller = await getCallerProfile();

    if (!caller) {
      return {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "You must be signed in to manage team members.",
        },
      };
    }

    const teamsService = getTeamsService();
    await teamsService.removeTeamMember(teamId, profileId, caller);
    return { success: true, data: undefined };
  } catch (error) {
    const appError = normalizeError(error);
    return {
      success: false,
      error: { code: appError.code, message: appError.message },
    };
  }
}
