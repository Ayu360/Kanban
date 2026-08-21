/**
 * employeesLifecycleLog — low-level helper for writing audit log entries.
 *
 * Writes a row to public.employee_lifecycle_log via the service-role client.
 * Used by all Server Actions (both existing extensions and new lifecycle actions)
 * to maintain a compliance-grade append-only audit trail.
 *
 * Design decisions:
 *
 *   1. The log write is AWAITED — a lost audit entry is a compliance gap.
 *      Log failure must NOT roll back the primary operation, but the Server
 *      Action must be informed so it can surface the failure in observability.
 *      Pattern: try the write → on failure, console.error with structured
 *      context AND throw a LogWriteError so the caller can decide what to do.
 *      Callers (Server Actions) catch LogWriteError, log it, and return the
 *      primary success result — the log failure is surfaced in server logs
 *      but not surfaced to the end user (a log write failure is an ops concern,
 *      not a user-facing error).
 *
 *   2. Supabase calls ONLY happen in this file for the log table — consistent
 *      with the single-point-of-Supabase-contact principle from ADR-0004.
 *      However, because the lifecycle log is a cross-cutting concern shared
 *      by multiple Server Actions (not a single aggregate), it lives as a
 *      standalone helper rather than inside SupabaseEmployeesRepository.
 *
 *   3. target_email and target_company_id must be captured BEFORE any DELETE
 *      operation on the target profile row. The caller is responsible for
 *      fetching these values. This function accepts them as parameters — it
 *      does NOT look them up (avoids a race condition where the lookup runs
 *      after the profile is already deleted).
 *
 *   4. action is typed as LifecycleLogAction (union of the 10 valid values
 *      matching the DB CHECK constraint). TypeScript enforces this at compile
 *      time; the DB constraint enforces it at runtime.
 *
 * All callers use the service-role client pattern established in
 * SupabaseEmployeesRepository (getSupabaseServiceRoleClient).
 */

import "server-only";

import type { LifecycleLogAction } from "../types";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// LogWriteError — distinguishes log-write failures from primary-op failures
// ---------------------------------------------------------------------------

/**
 * Thrown when the lifecycle log INSERT fails.
 * Callers should catch this, log it server-side, and NOT surface it to the
 * end user — the primary operation was already committed.
 */
export class LogWriteError extends Error {
  constructor(
    message: string,
    public readonly originalError: unknown
  ) {
    super(message);
    this.name = "LogWriteError";
  }
}

// ---------------------------------------------------------------------------
// writeLifecycleLog
// ---------------------------------------------------------------------------

/**
 * Parameters for a lifecycle log entry.
 *
 * @param actorProfileId   - Profile ID of the admin who performed the action.
 *                           Pass null when the action is system-initiated
 *                           (e.g., cron-promoted deletion, though that path
 *                           uses the DB function directly and should not
 *                           reach this helper).
 * @param targetProfileId  - Profile ID of the affected employee at action time.
 *                           Pass null only when the profile has already been
 *                           deleted before the log write (hard_deleted path
 *                           writes before deletion, so this should always be
 *                           non-null at log-write time for Server Action paths).
 * @param targetEmail      - Email captured at action time. Survives deletion.
 *                           Must be fetched from the profile BEFORE any DELETE.
 * @param targetCompanyId  - Company ID captured at action time. RLS scope post-deletion.
 * @param action           - Lifecycle event type (typed union, matches DB CHECK).
 * @param metadata         - Optional extra context (e.g., { old_role, new_role }).
 */
export interface WriteLifecycleLogParams {
  actorProfileId: string | null;
  targetProfileId: string | null;
  targetEmail: string;
  targetCompanyId: string;
  action: LifecycleLogAction;
  metadata?: Record<string, unknown>;
}

/**
 * Inserts a row into public.employee_lifecycle_log.
 *
 * - ALWAYS await this call — a missed audit entry is a compliance gap.
 * - Throws LogWriteError on failure. Callers must catch it, log it with
 *   console.error (structured context), and continue returning their primary
 *   success result. The primary operation is NOT rolled back on log failure.
 *
 * @throws {LogWriteError} if the INSERT fails.
 */
export async function writeLifecycleLog(
  params: WriteLifecycleLogParams
): Promise<void> {
  const serviceClient = getSupabaseServiceRoleClient();

  const { error } = await serviceClient.from("employee_lifecycle_log").insert({
    actor_profile_id: params.actorProfileId,
    target_profile_id: params.targetProfileId,
    target_email: params.targetEmail,
    target_company_id: params.targetCompanyId,
    action: params.action,
    metadata: params.metadata ?? null,
  });

  if (error) {
    throw new LogWriteError(
      `[writeLifecycleLog] Failed to write '${params.action}' log entry ` +
        `for target=${params.targetEmail} (${params.targetProfileId ?? "deleted"}) ` +
        `actor=${params.actorProfileId ?? "system"} company=${params.targetCompanyId}.`,
      error
    );
  }
}
