/**
 * SupabaseTeamsRepository — Supabase implementation of TeamsRepository.
 *
 * This is the ONLY file in the teams feature that is allowed to call Supabase
 * clients directly. All Supabase-specific types (PostgrestError) are caught
 * here and re-thrown as AppError so that the service layer and hooks never
 * see Supabase internals (ADR-0004).
 *
 * Two client factories are used:
 *   - getSupabaseServerClient()      — anon key + RLS. Used for all reads,
 *                                      create (via RPC), and rename.
 *   - getSupabaseServiceRoleClient() — bypasses RLS. Used for delete,
 *                                      addMember, and removeMember per the
 *                                      signed-off DB handoff contract (lines
 *                                      436-437). Service-layer authz checks
 *                                      (isPlatformAdmin || role === 'admin')
 *                                      remain the primary authorization guard;
 *                                      RLS on team_members is a redundant
 *                                      secondary check when service-role is used.
 *
 * Error mapping mirrors the mapAuthError pattern from SupabaseAuthRepository.
 * PostgreSQL error codes are mapped to AppErrorCode before surfacing up.
 *
 * Security note on delete:
 *   The service-role delete MUST include .eq('company_id', callerCompanyId).
 *   The callerCompanyId value is derived from the authenticated JWT by the
 *   service layer — it is never accepted from the client. This ensures that
 *   even with service-role (which bypasses RLS), a cross-company delete is
 *   structurally impossible via this code path.
 */

import "server-only";

import type { TeamsRepository } from "./TeamsRepository";
import type { Team, TeamMember, CreateTeamResult } from "../types";
import { AppError } from "../types";
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { normalizePostgRESTCount } from "../utils/aggregates";

// ---------------------------------------------------------------------------
// PostgreSQL error code constants
// ---------------------------------------------------------------------------

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";
const PG_FK_VIOLATION = "23503";
const PG_INSUFFICIENT_PRIVILEGE = "42501";

// PostgREST "no rows returned" code (single() call with no result)
const POSTGREST_NO_ROWS = "PGRST116";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw teams row (with embedded team_members count aggregate) into
 * a domain Team DTO. Keeps Supabase column naming (snake_case) isolated here.
 *
 * `team_members` is the PostgREST embedded aggregate shape:
 *   [{ count: number }]
 * A missing or empty array means 0 members (LEFT JOIN returned no rows).
 */
function rowToTeam(row: {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  team_members?: Array<{ count: number | string }> | null;
}): Team {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    memberCount: normalizePostgRESTCount(row.team_members?.[0]?.count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Converts a raw team_members + profiles join row into a domain TeamMember DTO.
 *
 * Schema note (migration 20260819000001):
 *   - `id` is now included from the select — it is the surrogate UUID PK.
 *   - `profile_id` is now nullable; a null value is a tombstone row.
 *     The profiles join returns null for tombstone rows (no profile to join to).
 */
function rowToTeamMember(row: {
  id: string;
  team_id: string;
  profile_id: string | null;
  created_at: string;
  profiles: {
    display_name: string | null;
    role: string | null;
  } | null;
  // email comes from auth.users and may not be selectable via profiles join;
  // we surface null when not available
}): TeamMember {
  return {
    id: row.id,
    teamId: row.team_id,
    profileId: row.profile_id,
    createdAt: row.created_at,
    displayName: row.profiles?.display_name ?? null,
    email: null, // auth.users.email is not accessible via public schema joins without service-role
    role: row.profiles?.role ?? null,
  };
}

/**
 * Maps a PostgrestError to an AppError.
 *
 * Priority: error.code (Postgres SQLSTATE) first, then message substring as
 * a last-resort fallback — mirrors the mapAuthError pattern in SupabaseAuthRepository.
 *
 * Teams-specific error codes:
 *   23505 (unique_violation)     → CONFLICT
 *   23514 (check_violation)      → VALIDATION_ERROR or CROSS_COMPANY (by message)
 *   23503 (fk_violation)         → NOT_FOUND
 *   42501 (insufficient_priv)    → FORBIDDEN
 *   PGRST116                     → NOT_FOUND (no rows from single())
 *   anything else                → UNKNOWN_ERROR
 */
function mapPostgrestError(
  error: { code?: string; message?: string; details?: string | null },
  context: string
): AppError {
  const code = error.code ?? "";
  const message = error.message ?? "";
  const lower = message.toLowerCase();

  switch (code) {
    case PG_UNIQUE_VIOLATION:
      return new AppError(
        "CONFLICT",
        "A team with this name already exists in your company.",
        error
      );

    case PG_CHECK_VIOLATION:
      // Cross-company membership attempt (from check_team_member_company_match trigger)
      if (lower.includes("cross-company")) {
        return new AppError(
          "CROSS_COMPANY",
          "Cannot add a member from a different company.",
          error
        );
      }
      // Team name validation failures from the RPC (L-1 fix messages)
      if (lower.includes("cannot be null")) {
        return new AppError("VALIDATION_ERROR", "Team name is required.", error);
      }
      if (lower.includes("cannot be empty")) {
        return new AppError("VALIDATION_ERROR", "Team name cannot be empty.", error);
      }
      if (lower.includes("exceeds maximum length")) {
        return new AppError(
          "VALIDATION_ERROR",
          "Team name cannot exceed 100 characters.",
          error
        );
      }
      // Company_id consistency triggers (boards/columns) — treat as internal error
      if (lower.includes("must equal")) {
        return new AppError(
          "UNKNOWN_ERROR",
          `Data consistency error in ${context}. Please contact support.`,
          error
        );
      }
      // Generic check violation fallback — use a safe fixed string, not the raw
      // PostgrestError.message which may contain constraint names or table names.
      // The original error is preserved as the cause for server-side inspection.
      return new AppError("VALIDATION_ERROR", "Validation failed.", error);

    case PG_FK_VIOLATION:
      return new AppError(
        "NOT_FOUND",
        "The referenced team or profile does not exist.",
        error
      );

    case PG_INSUFFICIENT_PRIVILEGE:
      return new AppError(
        "FORBIDDEN",
        "You do not have permission to perform this action.",
        error
      );

    case POSTGREST_NO_ROWS:
      return new AppError(
        "NOT_FOUND",
        `${context} not found.`,
        error
      );

    default:
      // Last-resort message substring fallback
      if (lower.includes("insufficient_privilege") || lower.includes("permission denied")) {
        return new AppError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          error
        );
      }
      return new AppError(
        "UNKNOWN_ERROR",
        `An unexpected error occurred in ${context}. Please try again.`,
        error
      );
  }
}

// ---------------------------------------------------------------------------
// SupabaseTeamsRepository
// ---------------------------------------------------------------------------

export class SupabaseTeamsRepository implements TeamsRepository {
  // -------------------------------------------------------------------------
  // listByCompany
  // -------------------------------------------------------------------------
  async listByCompany(companyId: string): Promise<Team[]> {
    const supabase = await getSupabaseServerClient();

    // team_members(count) is a PostgREST embedded aggregate.
    // Result shape per row: { ..., team_members: [{ count: number }] }
    // rowToTeam normalizes this into the memberCount field.
    const { data, error } = await supabase
      .from("teams")
      .select("id, company_id, name, created_at, updated_at, team_members(count)")
      .eq("company_id", companyId)
      .order("name", { ascending: true });

    if (error) {
      throw mapPostgrestError(error, "listByCompany");
    }

    return (data ?? []).map((row) =>
      rowToTeam(row as unknown as Parameters<typeof rowToTeam>[0])
    );
  }

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------
  async getById(teamId: string): Promise<Team | null> {
    const supabase = await getSupabaseServerClient();

    // Include team_members(count) so getById returns a complete Team DTO
    // (memberCount is required on Team — no optional-field ambiguity).
    const { data, error } = await supabase
      .from("teams")
      .select("id, company_id, name, created_at, updated_at, team_members(count)")
      .eq("id", teamId)
      .single();

    if (error) {
      if (error.code === POSTGREST_NO_ROWS) {
        return null;
      }
      throw mapPostgrestError(error, "getById");
    }

    if (!data) return null;

    return rowToTeam(data as unknown as Parameters<typeof rowToTeam>[0]);
  }

  // -------------------------------------------------------------------------
  // create — calls the create_team_with_board RPC
  // -------------------------------------------------------------------------
  async create(input: { companyId: string; name: string }): Promise<CreateTeamResult> {
    const supabase = await getSupabaseServerClient();

    // CRITICAL: Do NOT pass p_caller_id — the parameter was removed in the C-1
    // security fix. The RPC derives caller identity from auth.uid() internally.
    // Passing caller identity here would re-introduce the privilege escalation
    // vulnerability the DB team explicitly fixed.
    const { data, error } = await supabase.rpc("create_team_with_board", {
      p_company_id: input.companyId,
      p_name: input.name,
    });

    if (error) {
      throw mapPostgrestError(error, "create");
    }

    if (!data || typeof data !== "object") {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Team creation returned no data. Please try again."
      );
    }

    // The RPC returns { team_id: string, board_id: string }
    const result = data as { team_id: string; board_id: string };

    if (!result.team_id || !result.board_id) {
      throw new AppError(
        "UNKNOWN_ERROR",
        "Team creation returned incomplete data. Please contact support."
      );
    }

    return {
      teamId: result.team_id,
      boardId: result.board_id,
    };
  }

  // -------------------------------------------------------------------------
  // rename
  // -------------------------------------------------------------------------
  async rename(teamId: string, name: string): Promise<Team> {
    const supabase = await getSupabaseServerClient();

    // Include team_members(count) so the returned Team DTO is complete.
    const { data, error } = await supabase
      .from("teams")
      .update({ name })
      .eq("id", teamId)
      .select("id, company_id, name, created_at, updated_at, team_members(count)")
      .single();

    if (error) {
      throw mapPostgrestError(error, "rename");
    }

    if (!data) {
      throw new AppError("NOT_FOUND", "Team not found.", undefined);
    }

    return rowToTeam(data as unknown as Parameters<typeof rowToTeam>[0]);
  }

  // -------------------------------------------------------------------------
  // delete — uses SERVICE-ROLE client with mandatory company scoping
  // -------------------------------------------------------------------------
  async delete(teamId: string, callerCompanyId: string): Promise<void> {
    // Service-role bypasses RLS — the callerCompanyId filter is the
    // application-layer safeguard ensuring we never delete across company
    // boundaries, even with the elevated client.
    //
    // callerCompanyId is derived from the authenticated JWT by the service
    // layer, never from client-supplied input.
    const serviceClient = getSupabaseServiceRoleClient();

    const { error, count } = await serviceClient
      .from("teams")
      .delete({ count: "exact" })
      .eq("id", teamId)
      .eq("company_id", callerCompanyId);

    if (error) {
      throw mapPostgrestError(error, "delete");
    }

    // count = 0 means either the team didn't exist or the company_id filter
    // excluded it — treat as not found / forbidden.
    if (count === 0) {
      throw new AppError(
        "NOT_FOUND",
        "Team not found or you do not have permission to delete it."
      );
    }
  }

  // -------------------------------------------------------------------------
  // listMembers
  // -------------------------------------------------------------------------
  async listMembers(teamId: string): Promise<TeamMember[]> {
    const supabase = await getSupabaseServerClient();

    // `id` is selected to expose the surrogate UUID PK (added in migration
    // 20260819000001). It is used as the React key and for tombstone removal.
    // `profile_id` is nullable after migration 20260819000001 — tombstone rows
    // (profile of a deleted employee) have profile_id = NULL.
    const { data, error } = await supabase
      .from("team_members")
      .select(
        "id, team_id, profile_id, created_at, profiles(display_name, role)"
      )
      .eq("team_id", teamId)
      .order("created_at", { ascending: true });

    if (error) {
      throw mapPostgrestError(error, "listMembers");
    }

    type MemberRow = {
      id: string;
      team_id: string;
      profile_id: string | null;
      created_at: string;
      profiles: { display_name: string | null; role: string | null } | null;
    };

    return (data ?? []).map((row) =>
      rowToTeamMember(row as unknown as MemberRow)
    );
  }

  // -------------------------------------------------------------------------
  // addMember — uses SERVICE-ROLE per DB handoff contract (lines 436-437)
  // -------------------------------------------------------------------------
  async addMember(teamId: string, profileId: string): Promise<void> {
    // Service-role matches the DB handoff contract. The service layer's
    // authz check (isPlatformAdmin || role === 'admin') is the primary guard;
    // RLS on team_members is a redundant secondary check at this point.
    const serviceClient = getSupabaseServiceRoleClient();

    // ON CONFLICT DO NOTHING makes this idempotent (PRD FR-04: adding an
    // already-existing member is a no-op). After migration 20260819000001 the
    // composite PK (team_id, profile_id) was demoted to a UNIQUE constraint;
    // PostgREST onConflict works with UNIQUE constraints as well as PKs, so
    // the conflict target string "team_id,profile_id" continues to work correctly.
    const { error } = await serviceClient
      .from("team_members")
      .upsert(
        { team_id: teamId, profile_id: profileId },
        { onConflict: "team_id,profile_id", ignoreDuplicates: true }
      );

    if (error) {
      throw mapPostgrestError(error, "addMember");
    }
  }

  // -------------------------------------------------------------------------
  // removeMember — uses SERVICE-ROLE per DB handoff contract (lines 436-437)
  // -------------------------------------------------------------------------
  async removeMember(teamId: string, profileId: string): Promise<void> {
    // FOOTGUN GUARD: never call this with a null profileId.
    // `.eq("profile_id", null)` would match ALL tombstone rows in the team.
    // Use removeMemberById for tombstone removal.
    if (profileId === null || profileId === undefined) {
      throw new AppError(
        "VALIDATION_ERROR",
        "removeMember requires a non-null profileId. Use removeMemberById to remove tombstone rows."
      );
    }

    // Service-role matches the DB handoff contract. Scoped by both team_id
    // AND profile_id to prevent unintended broad deletes.
    const serviceClient = getSupabaseServiceRoleClient();

    const { error } = await serviceClient
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("profile_id", profileId);

    if (error) {
      throw mapPostgrestError(error, "removeMember");
    }
    // A no-op delete (row didn't exist) is acceptable — idempotent removal.
  }

  // -------------------------------------------------------------------------
  // removeMemberById — tombstone removal via surrogate UUID PK
  // -------------------------------------------------------------------------
  /**
   * Removes a team_members row by its surrogate UUID primary key.
   *
   * This is the ONLY safe way to remove a tombstone row (profile_id = null).
   * Uses `.eq("id", memberRowId).eq("team_id", teamId)` — dual-column guard
   * prevents cross-team deletes even with service-role access.
   *
   * Uses service-role because tombstone rows have profile_id = null and are
   * therefore invisible to any RLS policy that filters on auth.uid() = profile_id.
   */
  async removeMemberById(memberRowId: string, teamId: string): Promise<void> {
    const serviceClient = getSupabaseServiceRoleClient();

    const { error } = await serviceClient
      .from("team_members")
      .delete()
      .eq("id", memberRowId)
      .eq("team_id", teamId); // dual-column guard — prevents cross-team deletes

    if (error) {
      throw mapPostgrestError(error, "removeMemberById");
    }
    // A no-op delete (row didn't exist) is acceptable — idempotent removal.
  }
}
