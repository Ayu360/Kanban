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
 *
 * Schema note (migration 20260819000001):
 *   - `id` is the new surrogate UUID primary key on team_members. Use this
 *     as the React key and for operations that must target a specific row
 *     (e.g., removing a tombstone row where profileId is null).
 *   - `profileId` is now nullable. A null value means the row is a tombstone:
 *     the employee who held this membership slot has been hard-deleted.
 *     Tombstone rows are rendered as "[Deleted User]" and can only be removed
 *     via removeMemberById (not removeMember, which requires a non-null profileId).
 */
export interface TeamMember {
  /** Surrogate UUID PK on team_members (added in migration 20260819000001). */
  id: string;
  teamId: string;
  /**
   * Profile ID of the member. Null when the profile has been hard-deleted
   * (tombstone row). Never pass null to removeMember — use removeMemberById instead.
   */
  profileId: string | null;
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

/**
 * Input for removing a tombstone row (profile_id = null) from a team.
 * Tombstone rows cannot be removed via RemoveTeamMemberInput because the
 * surrogate `memberRowId` (team_members.id) is required to target the
 * specific row — a null profileId would match ALL tombstones in the team.
 */
export interface RemoveTombstoneInput {
  teamId: string;
  memberRowId: string;
}

// ---------------------------------------------------------------------------
// Action result data shapes
// ---------------------------------------------------------------------------

export interface CreateTeamResult {
  teamId: string;
  boardId: string;
}
