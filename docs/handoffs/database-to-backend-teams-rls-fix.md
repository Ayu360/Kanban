# Teams RLS Fix — Database to Backend Handoff

**Migration file:** `supabase/migrations/20260816000001_fix_team_members_rls_recursion.sql`
**Status:** DEPLOYED — verified working on remote (`yozwyoeksgdcdmkowupt`) on 2026-08-16
**Date:** 2026-08-16
**Prepared by:** Database Agent

---

## Overview

This migration fixes an infinite-recursion error that blocked every SELECT touching
`public.team_members`. The bug affected all callers (platform admin, company admin,
employee) because PostgreSQL evaluates all permissive policies in OR and the
recursive one aborted the statement before any policy could return true.

---

## What Changed at the Database Layer

### New function: `public.is_team_member(uuid) RETURNS boolean`

A `SECURITY DEFINER STABLE` helper that returns true if `auth.uid()` has a
`team_members` row for the given `team_id`. Because it is SECURITY DEFINER, the
SELECT inside it runs as the function owner (postgres superuser), bypassing RLS on
`team_members`. This breaks the recursion path.

Grant state:
- `REVOKE ALL FROM PUBLIC`
- `GRANT EXECUTE TO authenticated`

### Replaced: `teams_select_member` (ON `public.teams`)

Was: `EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = id AND tm.profile_id = auth.uid())`
Now: `public.is_team_member(id)`

Behavior is identical. Employees see teams they have a `team_members` row for.

### Replaced: `team_members_select_member` (ON `public.team_members`)

Was: `EXISTS (SELECT 1 FROM public.team_members tm_self WHERE tm_self.team_id = team_id AND tm_self.profile_id = auth.uid())`
Now: `public.is_team_member(team_id)`

Behavior is identical. Employees see all `team_members` rows for teams they belong
to (FR-07 — co-member visibility). The SECURITY DEFINER helper prevents the
self-referential recursion that was caused by the old EXISTS subquery reading the
same table the policy is defined on.

### Untouched

All other policies, indexes, constraints, triggers, grants, and functions from
`20260809000001_teams_schema.sql` are unchanged. Only the two `_select_member`
policies were replaced.

---

## Impact on Backend Integration

**No backend code changes are required.** The fix is entirely at the database
layer. The public interface of `public.teams` and `public.team_members` is
unchanged. The repository queries documented in `database-to-backend-teams.md`
will now execute without error.

### Specific queries that were broken and are now fixed

- `supabase.from('teams').select('*')` as an employee
- `supabase.from('teams').select('*, team_members(count)')` (PostgREST aggregate)
- Any query that triggered a join or subquery into `team_members` under RLS

### Integration tests to rerun after deploy

From `database-to-backend-teams.md`, the following tests were implicitly broken
by this bug and must pass after the fix is deployed:

1. **Team isolation** — Employee A queries `teams`, sees only their own teams.
2. **Member visibility (FR-07)** — Employee A can see co-members of their team via `team_members`.
3. **Company admin access** — Company admin queries `teams`, sees all company teams.
4. **Platform admin access** — Platform admin queries `teams`, sees all teams.
5. **Membership removal revokes access** — After removing Employee A from a team,
   the team no longer appears in their `teams` query.

Add this new test:

- **PostgREST aggregate does not recurse** — Run
  `supabase.from('teams').select('*, team_members(count)')` as an authenticated
  employee. Assert it returns rows without error code `42P17`
  ("infinite recursion detected in policy").

---

## No Other Backend Changes Required

No repository methods, Server Actions, or TanStack Query hooks assumed the broken
recursive behavior. The queries were intended to work; the bug simply prevented
them from running at all. Deploying this migration restores the intended behavior
with no application-side changes.

---

## Deployment Steps (completed 2026-08-16)

1. Ran `supabase db push` against remote project `yozwyoeksgdcdmkowupt`. Migration applied cleanly.
2. Verified `/teams` loads as platform admin without the `infinite recursion` error.
3. Integration test rerun is still pending — tracked as a follow-up in the Backend queue.

---

## Next Steps

1. Backend Agent: rerun the integration test suite from `database-to-backend-teams.md`.
2. Add a pgTAP test (or equivalent) that asserts `team_members_select_member`
   does not recurse — query `team_members` as an employee and assert it returns
   rows rather than raising error code `42P17`.
3. No further database changes are required for this fix.
