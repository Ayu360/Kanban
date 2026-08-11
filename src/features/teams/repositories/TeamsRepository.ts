/**
 * TeamsRepository — the repository interface for the teams feature.
 *
 * This is the swap seam (ADR-0004). The service layer depends on this
 * interface, not on SupabaseTeamsRepository. Swapping the backend means
 * providing a new concrete implementation; nothing above this layer changes.
 *
 * Design rules:
 *   - All methods return domain types (Team, TeamMember, etc.), never Supabase types.
 *   - All methods throw AppError on failure, never PostgrestError.
 *   - Methods are async. No synchronous reads.
 *   - No Supabase imports in this file.
 *   - The `delete` method accepts callerCompanyId to ensure the service-role
 *     delete is always company-scoped (security requirement from DB handoff).
 */

import type { Team, TeamMember, CreateTeamResult } from "../types";

export interface TeamsRepository {
  /**
   * Lists all teams visible to the given company.
   * RLS on the anon client filters by role automatically — company admin sees
   * all teams in their company, employees see only their member teams.
   *
   * Throws AppError on query failure.
   */
  listByCompany(companyId: string): Promise<Team[]>;

  /**
   * Fetches a single team by ID.
   * Returns null if the team does not exist or is not visible to the caller.
   *
   * Throws AppError on query failure.
   */
  getById(teamId: string): Promise<Team | null>;

  /**
   * Creates a team (and its board + seeded columns) atomically via the
   * `create_team_with_board` RPC.
   *
   * IMPORTANT: The RPC derives caller identity from auth.uid() — do NOT
   * pass any caller identity parameter. The RPC performs authorization
   * inside the function using the session JWT (C-1 security fix).
   *
   * Returns { teamId, boardId } from the RPC result.
   *
   * Throws AppError with:
   *   - VALIDATION_ERROR for null/empty/oversized name (check_violation from RPC)
   *   - CONFLICT for duplicate name within company (unique_violation)
   *   - FORBIDDEN for unauthorized caller (insufficient_privilege)
   *   - UNKNOWN_ERROR for unexpected failures
   */
  create(input: { companyId: string; name: string }): Promise<CreateTeamResult>;

  /**
   * Renames a team.
   * Uses the anon-key client — RLS enforces authorization (company admin only).
   *
   * Returns the updated Team.
   *
   * Throws AppError with:
   *   - CONFLICT for duplicate name within company (unique_violation)
   *   - VALIDATION_ERROR for empty/oversized name (check_violation)
   *   - NOT_FOUND if team does not exist or is not visible
   *   - UNKNOWN_ERROR for unexpected failures
   */
  rename(teamId: string, name: string): Promise<Team>;

  /**
   * Deletes a team and all its cascade-linked records (board, columns, team_members).
   *
   * IMPORTANT: Uses the SERVICE-ROLE client (bypasses RLS). The callerCompanyId
   * filter is applied as a mandatory application-layer safeguard so that the
   * service-role delete never touches teams outside the caller's company.
   *
   * Platform admins pass their own companyId for scope OR this method is called
   * with the explicit team's companyId retrieved from getById first.
   *
   * Throws AppError with:
   *   - NOT_FOUND if no team matched (teamId + callerCompanyId filter returned 0 rows)
   *   - UNKNOWN_ERROR for unexpected failures
   */
  delete(teamId: string, callerCompanyId: string): Promise<void>;

  /**
   * Lists members of a team, enriched with profile display data.
   * Uses the anon-key client — RLS enforces read access.
   *
   * Throws AppError on query failure.
   */
  listMembers(teamId: string): Promise<TeamMember[]>;

  /**
   * Adds a profile to a team.
   * Uses ON CONFLICT DO NOTHING — idempotent per PRD FR-04.
   *
   * The cross-company guard trigger fires synchronously and raises
   * check_violation (23514) if the profile and team are in different companies.
   *
   * Throws AppError with:
   *   - CROSS_COMPANY if the profile belongs to a different company than the team
   *   - NOT_FOUND if the team or profile does not exist (foreign_key_violation)
   *   - UNKNOWN_ERROR for unexpected failures
   *
   * Returns void for success (including idempotent "already member" case).
   */
  addMember(teamId: string, profileId: string): Promise<void>;

  /**
   * Removes a profile from a team.
   * Deletes the team_members row. A no-op if the row does not exist.
   *
   * Throws AppError on unexpected failures.
   */
  removeMember(teamId: string, profileId: string): Promise<void>;
}
