/**
 * Auth-sweep cron endpoint — sweeps orphaned auth.users rows.
 *
 * Route: GET /api/cron/sweep-orphaned-auth
 *
 * Called by Vercel Cron on a schedule defined in vercel.json.
 * Vercel Cron sets the Authorization header to `Bearer <CRON_SECRET>` on
 * every invocation. All other callers receive 401.
 *
 * Why this exists:
 *   The pg_cron job (_promote_scheduled_deletions) runs inside PostgreSQL and
 *   deletes profiles rows for soft-deleted employees whose grace window has
 *   expired. However, PostgreSQL cannot call the Supabase Auth admin HTTP API.
 *   After the profiles row is gone, the corresponding auth.users row persists
 *   as an orphan. The orphaned user cannot log in (the JWT hook finds no
 *   profiles row and returns no claims; middleware blocks them), but their
 *   email address is tied up in auth.users, preventing re-invitation.
 *
 *   The same orphan pattern occurs when cancelInviteAction deletes the profiles
 *   row successfully but auth.admin.deleteUser fails (transient error path).
 *
 *   This endpoint iterates all auth.users rows, identifies those with no
 *   corresponding profiles row, and calls auth.admin.deleteUser for each.
 *
 * 10-minute grace window (critical — do NOT remove):
 *   New auth.users rows (from inviteUserByEmail) are created BEFORE the
 *   corresponding profiles row is inserted by inviteEmployeeAction. If the
 *   sweep runs in that narrow window, it would delete the auth user that was
 *   just invited. The 10-minute filter (created_at < now() - 10 minutes)
 *   ensures newly invited auth users are never swept before the profiles row
 *   has time to be created. This is a hard constraint from the DB handoff
 *   (R-NEW-1 section).
 *
 * Pagination:
 *   auth.admin.listUsers returns up to 1000 users per page. For tenants with
 *   more than 1000 auth.users rows, the endpoint paginates via the `nextPage`
 *   cursor returned by the Supabase admin API until all pages are exhausted.
 *
 * Vercel plan note:
 *   Vercel Hobby restricts cron jobs to once per day (midnight UTC).
 *   Vercel Pro and above supports the every-5-minutes schedule ("*\/5 * * * *") in vercel.json.
 *   Auth cleanup is not time-critical — orphaned auth rows cannot log in and
 *   do not occupy a session slot. Daily cleanup (Hobby) is acceptable.
 *   See vercel.json and deploy notes in docs/handoffs/ for the plan-aware schedule.
 *
 * Security:
 *   - No unauthenticated access. CRON_SECRET header check is the sole gate.
 *   - Service-role client is used for all Supabase calls. Never exposed to
 *     client code. The service-role key is read from the server environment only.
 *   - This route is NOT exported with 'use server' — it is a Route Handler,
 *     not a Server Action.
 */

import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // -------------------------------------------------------------------------
  // Authorization: Vercel Cron sets Authorization: Bearer <CRON_SECRET>.
  // Reject all other callers with 401.
  // CRON_SECRET must be set in Vercel environment variables (and locally in
  // .env.local for development). The variable must NOT be prefixed with NEXT_PUBLIC_.
  // -------------------------------------------------------------------------
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is not configured at all, block unconditionally to prevent
  // accidental open access in environments where the env var was not set.
  if (!cronSecret) {
    console.error(
      "[sweep-orphaned-auth] CRON_SECRET environment variable is not set. " +
        "All cron requests will be rejected until it is configured."
    );
    return Response.json(
      { error: "Cron endpoint is not configured." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  // -------------------------------------------------------------------------
  // Main sweep logic
  // -------------------------------------------------------------------------
  const serviceClient = getSupabaseServiceRoleClient();

  // 10-minute grace window cutoff.
  // auth.users rows created within the last 10 minutes are NEVER swept.
  // This prevents the race where a fresh invite's auth.users row is deleted
  // before inviteEmployeeAction inserts the profiles row (R-NEW-1).
  const graceCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  let swept = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  // Paginate through all auth.users using Supabase admin listUsers.
  // Each page is up to 1000 users. We loop until nextPage is null.
  let page = 1;

  while (true) {
    const { data: listData, error: listError } =
      await serviceClient.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

    if (listError) {
      console.error(
        `[sweep-orphaned-auth] Failed to list auth.users (page ${page}).`,
        listError
      );
      return Response.json(
        {
          swept,
          errors: [
            ...errors,
            { userId: "list", error: listError.message },
          ],
          message: `Auth user listing failed on page ${page}. Partial sweep completed.`,
        },
        { status: 500 }
      );
    }

    const users = listData.users;

    // Apply the 10-minute grace window filter.
    const candidates = users.filter(
      (u) => u.created_at < graceCutoff
    );

    // For each candidate, check whether a profiles row exists.
    // We batch-check by querying profiles.id IN (...) rather than N individual
    // selects, for efficiency.
    if (candidates.length > 0) {
      const candidateIds = candidates.map((u) => u.id);

      const { data: profileRows, error: profileError } = await serviceClient
        .from("profiles")
        .select("id")
        .in("id", candidateIds);

      if (profileError) {
        console.error(
          `[sweep-orphaned-auth] Failed to query profiles on page ${page}.`,
          profileError
        );
        // Continue to next page rather than aborting the entire sweep.
      } else {
        const existingProfileIds = new Set(
          (profileRows ?? []).map((r: { id: string }) => r.id)
        );

        // Identify truly orphaned auth.users rows.
        const orphans = candidates.filter(
          (u) => !existingProfileIds.has(u.id)
        );

        for (const orphan of orphans) {
          const { error: deleteError } =
            await serviceClient.auth.admin.deleteUser(orphan.id);

          if (deleteError) {
            console.error(
              `[sweep-orphaned-auth] Failed to delete orphaned auth user ${orphan.id} (${orphan.email}).`,
              deleteError
            );
            errors.push({ userId: orphan.id, error: deleteError.message });
          } else {
            swept++;
            console.info(
              `[sweep-orphaned-auth] Deleted orphaned auth user: ${orphan.id} (${orphan.email ?? "no email"}).`
            );
          }
        }
      }
    }

    // Check whether there are more pages.
    // Supabase admin listUsers returns all users if total <= perPage.
    // When users.length < perPage, we have reached the last page.
    if (users.length < 1000) {
      break;
    }

    page++;
  }

  console.info(
    `[sweep-orphaned-auth] Sweep complete. swept=${swept} errors=${errors.length}.`
  );

  return Response.json({
    swept,
    errors,
    message: `Auth-sweep complete. ${swept} orphaned auth user(s) deleted. ${errors.length} error(s).`,
  });
}
