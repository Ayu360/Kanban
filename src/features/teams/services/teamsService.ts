/**
 * TeamsService — business logic layer for the teams feature.
 *
 * Orchestrates repository calls, enforces business rules, and is the single
 * place where domain-level authorization decisions are made (which roles can
 * perform which operations, cross-company scoping, name validation).
 *
 * This service is UI-agnostic and testable in isolation by mocking
 * the TeamsRepository interface.
 *
 * Authorization model (ADR-0008, ADR-0009):
 *   - Platform admin (is_platform_admin = true): can manage any team in any company.
 *   - Company admin (role = 'admin'): can manage teams within their own company_id.
 *   - Employee (role = 'employee'): read-only access to their member teams via RLS.
 *     Server Actions are forbidden for employees — service checks return FORBIDDEN.
 *
 * IMPORTANT: is_platform_admin and role are INDEPENDENT dimensions (ADR-0008).
 *   A platform admin may have role = 'employee'. The check is:
 *   caller.isPlatformAdmin OR caller.role === 'admin'
 *   Do NOT require both.
 *
 * The repository (RLS + RPC) is the authoritative enforcement layer.
 * Service authz checks are defense-in-depth — they catch obvious misuse before
 * a database round-trip and surface clearer error messages.
 *
 * No Supabase types, no table names, no SQL in this file.
 */

import type { TeamsRepository } from "../repositories/TeamsRepository";
import type { Team, TeamMember, CreateTeamResult } from "../types";
import { AppError } from "../types";
import type { Profile } from "@/features/auth/types";
export { normalizeError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Validation helpers (pure functions, no I/O)
// ---------------------------------------------------------------------------

/**
 * Validates a team name.
 * Returns null on valid input or a user-facing error message string.
 *
 * Defense-in-depth: The DB RPC (create_team_with_board) also validates these
 * rules. Service-layer validation catches bad input before the DB round-trip
 * and produces a controlled message. The DB is still the concurrency-safe
 * authoritative gate.
 */
export function validateTeamName(name: string | undefined | null): string | null {
  if (name == null) return "Team name is required.";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Team name cannot be empty.";
  if (trimmed.length > 100) return "Team name cannot exceed 100 characters.";
  return null;
}

/**
 * Basic UUID shape check (RFC 4122 / v4 pattern).
 * Not exhaustive — just a sanity guard before DB round-trips.
 */
export function validateUUID(value: string | undefined | null, label: string): string | null {
  if (!value) return `${label} is required.`;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(value)) return `${label} is not a valid identifier.`;
  return null;
}

// normalizeError is re-exported from @/lib/errors (shared utility).
// The definition has been extracted there to eliminate the duplicate that
// existed between teamsService.ts and authService.ts.

// ---------------------------------------------------------------------------
// TeamsService
// ---------------------------------------------------------------------------

export class TeamsService {
  constructor(private readonly repo: TeamsRepository) {}

  // -------------------------------------------------------------------------
  // createTeam
  // -------------------------------------------------------------------------
  /**
   * Creates a team (and its board + seeded columns) atomically.
   *
   * Authorization: platform admin OR company admin for the target company.
   *
   * For platform admin creating in a company other than their own profile
   * company_id: the companyId param dictates the target company. RLS/RPC
   * enforce authorization inside the DB.
   *
   * Validation: name is validated here before the DB call. The DB RPC
   * also validates — this provides defense-in-depth and faster feedback.
   */
  async createTeam(
    input: { companyId: string; name: string },
    caller: Profile
  ): Promise<CreateTeamResult> {
    // Input validation
    const nameError = validateTeamName(input.name);
    if (nameError) {
      throw new AppError("VALIDATION_ERROR", nameError);
    }

    const companyIdError = validateUUID(input.companyId, "Company ID");
    if (companyIdError) {
      throw new AppError("VALIDATION_ERROR", companyIdError);
    }

    // Authorization check (defense-in-depth — RPC enforces via auth.uid())
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to create teams."
      );
    }

    // Company admin can only create in their own company
    if (!caller.isPlatformAdmin && caller.companyId !== input.companyId) {
      throw new AppError(
        "FORBIDDEN",
        "You can only create teams within your own company."
      );
    }

    return this.repo.create({ companyId: input.companyId, name: input.name.trim() });
  }

  // -------------------------------------------------------------------------
  // renameTeam
  // -------------------------------------------------------------------------
  /**
   * Renames a team.
   *
   * Authorization: platform admin OR company admin. For company admin,
   * the team must belong to their company (verified by fetching the team).
   */
  async renameTeam(
    teamId: string,
    name: string,
    caller: Profile
  ): Promise<Team> {
    // Input validation
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) {
      throw new AppError("VALIDATION_ERROR", teamIdError);
    }

    const nameError = validateTeamName(name);
    if (nameError) {
      throw new AppError("VALIDATION_ERROR", nameError);
    }

    // Authorization check (defense-in-depth)
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to rename teams."
      );
    }

    // Company admin: fetch team to verify same-company scope
    if (!caller.isPlatformAdmin) {
      const team = await this.repo.getById(teamId);
      if (!team) {
        throw new AppError("NOT_FOUND", "Team not found.");
      }
      if (team.companyId !== caller.companyId) {
        throw new AppError(
          "FORBIDDEN",
          "You can only rename teams within your own company."
        );
      }
    }

    return this.repo.rename(teamId, name.trim());
  }

  // -------------------------------------------------------------------------
  // deleteTeam
  // -------------------------------------------------------------------------
  /**
   * Deletes a team and all its cascade-linked data.
   *
   * Authorization: platform admin OR company admin.
   *
   * For platform admin: must look up the team first to get its company_id
   * (required by the repository's mandatory company-scoping filter).
   * For company admin: uses their own company_id as the scope.
   *
   * The repository uses service-role with .eq('company_id', callerCompanyId)
   * as a mandatory application-layer safeguard.
   */
  async deleteTeam(teamId: string, caller: Profile): Promise<void> {
    // Input validation
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) {
      throw new AppError("VALIDATION_ERROR", teamIdError);
    }

    // Authorization check (defense-in-depth)
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to delete teams."
      );
    }

    // Determine the company_id scope for the service-role delete
    let callerCompanyId: string;

    if (caller.isPlatformAdmin) {
      // Platform admin: fetch the team to get its actual company_id so the
      // repository can scope the service-role delete correctly.
      const team = await this.repo.getById(teamId);
      if (!team) {
        throw new AppError("NOT_FOUND", "Team not found.");
      }
      callerCompanyId = team.companyId;
    } else {
      // Company admin: scope to their own company — cannot delete across companies.
      callerCompanyId = caller.companyId;
    }

    return this.repo.delete(teamId, callerCompanyId);
  }

  // -------------------------------------------------------------------------
  // addTeamMember
  // -------------------------------------------------------------------------
  /**
   * Adds a profile to a team.
   *
   * Authorization: platform admin OR company admin.
   * Cross-company protection is enforced by the DB trigger (check_violation 23514).
   * The service does not pre-check company_id here — the DB is the authoritative
   * gate for the cross-company invariant, and it handles concurrent inserts safely.
   */
  async addTeamMember(
    teamId: string,
    profileId: string,
    caller: Profile
  ): Promise<void> {
    // Input validation
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) throw new AppError("VALIDATION_ERROR", teamIdError);

    const profileIdError = validateUUID(profileId, "Profile ID");
    if (profileIdError) throw new AppError("VALIDATION_ERROR", profileIdError);

    // Authorization check (defense-in-depth)
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to manage team members."
      );
    }

    return this.repo.addMember(teamId, profileId);
  }

  // -------------------------------------------------------------------------
  // removeTeamMember
  // -------------------------------------------------------------------------
  /**
   * Removes a live (non-tombstone) member from a team.
   *
   * Authorization: platform admin OR company admin.
   *
   * IMPORTANT: profileId must be a non-null, valid UUID. This method must
   * NOT be called for tombstone rows (profileId = null). Use removeTombstone
   * for tombstone removal — it routes to removeMemberById which uses the
   * surrogate `id` to target the specific row safely.
   */
  async removeTeamMember(
    teamId: string,
    profileId: string,
    caller: Profile
  ): Promise<void> {
    // Input validation
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) throw new AppError("VALIDATION_ERROR", teamIdError);

    // Explicit null guard — callers must not route tombstones here
    if (profileId === null || profileId === undefined) {
      throw new AppError(
        "VALIDATION_ERROR",
        "profileId is required. Use removeTombstone to remove tombstone rows."
      );
    }

    const profileIdError = validateUUID(profileId, "Profile ID");
    if (profileIdError) throw new AppError("VALIDATION_ERROR", profileIdError);

    // Authorization check (defense-in-depth)
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to manage team members."
      );
    }

    return this.repo.removeMember(teamId, profileId);
  }

  // -------------------------------------------------------------------------
  // removeTombstone
  // -------------------------------------------------------------------------
  /**
   * Removes a tombstone row (profile_id = null) from a team.
   *
   * Tombstone rows are team_members rows whose profile was hard-deleted.
   * They must be targeted by the surrogate `id` (memberRowId) rather than
   * profileId — a null profileId would match ALL tombstones in the team.
   *
   * Authorization: platform admin OR company admin.
   */
  async removeTombstone(
    teamId: string,
    memberRowId: string,
    caller: Profile
  ): Promise<void> {
    // Input validation
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) throw new AppError("VALIDATION_ERROR", teamIdError);

    const rowIdError = validateUUID(memberRowId, "Member row ID");
    if (rowIdError) throw new AppError("VALIDATION_ERROR", rowIdError);

    // Authorization check (defense-in-depth)
    const isAdmin = caller.isPlatformAdmin || caller.role === "admin";
    if (!isAdmin) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to manage team members."
      );
    }

    return this.repo.removeMemberById(memberRowId, teamId);
  }

  // -------------------------------------------------------------------------
  // listTeamsForCaller
  // -------------------------------------------------------------------------
  /**
   * Returns the teams visible to the caller based on their role.
   *
   *   - Platform admin: all teams for the given company (or all companies if
   *     a companyId is not specified — uses listByCompany with the caller's
   *     own company_id in MVP, as multi-company is post-MVP).
   *   - Company admin: all teams in their company.
   *   - Employee: listByCompany with RLS filtering automatically returning
   *     only teams the employee is a member of.
   *
   * In all cases the anon-key client + RLS is the authoritative filter.
   * This method simply chooses the correct query parameter.
   *
   * NOTE: Not called by any Server Action today. Browser read hooks (useTeams)
   * use the Supabase browser client + RLS directly. This method is reserved for
   * future server-side read flows (Server Components, admin panel, platform-admin
   * cross-company listing). Do not remove without a deliberate architectural
   * decision about server-side reads.
   */
  async listTeamsForCaller(caller: Profile): Promise<Team[]> {
    // Both platform_admin and company_admin use listByCompany(caller.companyId).
    // RLS on the anon client handles the filtering differences between roles.
    // A platform admin who wants cross-company access would need a separate
    // service-role query — not needed in MVP (single company, ADR-0006).
    return this.repo.listByCompany(caller.companyId);
  }

  // -------------------------------------------------------------------------
  // getTeam
  // -------------------------------------------------------------------------
  /**
   * Returns a single team by ID.
   * RLS on the anon client enforces visibility (employees only see their teams).
   *
   * NOTE: Not called by any Server Action today. Browser read hooks (useTeam)
   * use the Supabase browser client + RLS directly. Reserved for future
   * server-side read flows (Server Components, admin panel). Do not remove
   * without a deliberate architectural decision about server-side reads.
   */
  async getTeam(teamId: string): Promise<Team | null> {
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) throw new AppError("VALIDATION_ERROR", teamIdError);

    return this.repo.getById(teamId);
  }

  // -------------------------------------------------------------------------
  // listTeamMembers
  // -------------------------------------------------------------------------
  /**
   * Returns members of a team, enriched with profile display data.
   * RLS enforces read access — employees can only read members of their teams.
   *
   * NOTE: Not called by any Server Action today. Browser read hooks
   * (useTeamMembers) use the Supabase browser client + RLS directly. Reserved
   * for future server-side read flows (Server Components, admin panel, or
   * service-role reads to surface member emails). Do not remove without a
   * deliberate architectural decision about server-side reads.
   */
  async listTeamMembers(teamId: string): Promise<TeamMember[]> {
    const teamIdError = validateUUID(teamId, "Team ID");
    if (teamIdError) throw new AppError("VALIDATION_ERROR", teamIdError);

    return this.repo.listMembers(teamId);
  }
}
