/**
 * aggregates.ts — Pure utilities for normalizing PostgREST aggregate values.
 *
 * Client-safe: no server-only imports, no Supabase clients, no React
 * dependencies, no environment access. Safe to import from both server-side
 * repository code and browser-side hooks.
 *
 * Background: PostgREST embedded aggregates (e.g. `team_members(count)`) may
 * return the count field as a numeric string or as a number depending on the
 * client version and PostgREST version. Callers must not assume one or the
 * other — always normalize through this utility.
 */

/**
 * Normalizes a raw PostgREST embedded aggregate count value to a safe integer.
 *
 * Handles:
 *   - number        → returned as-is (clamped to 0 on NaN)
 *   - numeric string → parsed via parseInt (clamped to 0 on NaN)
 *   - empty array   → 0  (LEFT JOIN returned no rows, aggregate wrapper is [])
 *   - null / undefined → 0
 *   - any other unexpected type → 0
 *
 * This is the single canonical normalization for member count aggregates across
 * the teams feature. All three sites (repository rowToTeam, useTeams, useTeam)
 * delegate here.
 *
 * @param rawCount - The value at `row.team_members?.[0]?.count` — may be
 *                   `number | string | undefined | null`.
 * @returns A non-negative integer. Never NaN, never null.
 */
export function normalizePostgRESTCount(
  rawCount: number | string | undefined | null
): number {
  if (rawCount === null || rawCount === undefined) {
    return 0;
  }

  const coerced =
    typeof rawCount === "string" ? parseInt(rawCount, 10) : rawCount;

  return isNaN(coerced) ? 0 : coerced;
}
