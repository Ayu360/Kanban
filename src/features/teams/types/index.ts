/**
 * Domain DTOs for the teams feature.
 *
 * These types cross the repository boundary and are the canonical shape that
 * services, hooks, and components consume. No Supabase-specific types appear
 * here — the repository layer normalizes them before returning (ADR-0004).
 *
 * AppError, AppErrorCode, and ActionResult are imported from the shared auth
 * types module (the established cross-feature taxonomy). They are re-exported
 * here so teams-feature consumers have a single import point.
 */

// Re-export shared error/result types from auth (the established taxonomy).
// If these move to a dedicated shared module in the future, update this import.
export type { AppErrorCode, ActionResult } from "@/features/auth/types";
export { AppError } from "@/features/auth/types";

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * A team record.
 * Maps 1:1 to a row in public.teams, enriched with the aggregate member count.
 *
 * `memberCount` is required (not optional) on all Team instances — both the
 * list query and single-team fetch populate it. This avoids optional-field
 * ambiguity at call sites and keeps the type contract unambiguous.
 * A team with no members returns 0.
 */
export interface Team {
  id: string;
  companyId: string;
  name: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// TeamMember
// ---------------------------------------------------------------------------

/**
 * A team membership record, optionally enriched with profile display data.
 * Base fields map to public.team_members.
 * Enriched fields (displayName, email, role) are populated when the
 * repository joins to public.profiles (listMembers query).
 */
export interface TeamMember {
  teamId: string;
  profileId: string;
  createdAt: string;
  // Enriched from profiles join — may be null if profile data is unavailable
  displayName: string | null;
  email: string | null;
  role: string | null;
}

// ---------------------------------------------------------------------------
// Board (minimal — only fields needed by the backend surface)
// ---------------------------------------------------------------------------

/**
 * A board record — the read surface the backend exposes.
 * The full boards table schema is in the DB migration; only the fields needed
 * by the server action return types are modeled here.
 */
export interface Board {
  id: string;
  teamId: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
  companyId: string;
  name: string;
}

export interface RenameTeamInput {
  teamId: string;
  name: string;
}

export interface AddTeamMemberInput {
  teamId: string;
  profileId: string;
}

export interface RemoveTeamMemberInput {
  teamId: string;
  profileId: string;
}

// ---------------------------------------------------------------------------
// Action result data shapes
// ---------------------------------------------------------------------------

export interface CreateTeamResult {
  teamId: string;
  boardId: string;
}
