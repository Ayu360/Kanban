-- =============================================================================
-- Migration: 20260816000001_fix_team_members_rls_recursion.sql
--
-- Purpose:
--   Fix infinite-recursion errors on any query that touches public.team_members,
--   including embedded PostgREST aggregates such as select("*, team_members(count)").
--
-- Root cause:
--   Two RLS policies introduced in 20260809000001_teams_schema.sql caused PostgreSQL
--   to enter an infinite recursive loop when evaluating permissive SELECT policies:
--
--   1. team_members_select_member (ON public.team_members):
--      The USING clause contained an EXISTS subquery that reads public.team_members
--      again (aliased tm_self). PostgreSQL DOES re-enter all active permissive
--      policies when a subquery touches the same table inside a policy expression.
--      This is a genuine self-referential recursion that blows the statement before
--      any policy row is returned.
--
--   2. teams_select_member (ON public.teams):
--      The USING clause reads public.team_members. On its own this would be safe,
--      but because team_members_select_member is broken, any evaluation of the
--      teams_select_member policy cascades into that recursion.
--
--   The comments in the original migration ("PostgreSQL does NOT recursively
--   re-enter the outer policy") were factually incorrect. The runtime infinite-
--   recursion error is the proof. This migration corrects both the policies and
--   the record.
--
-- Fix:
--   Introduce a SECURITY DEFINER helper function public.is_team_member(uuid) that
--   reads public.team_members with RLS bypassed (by virtue of running as the
--   function owner, which is a superuser/postgres role). The two broken policies
--   are replaced with versions that call this helper instead of querying
--   public.team_members directly inside the policy expression. The helper breaks
--   the recursion because RLS is NOT applied when the SECURITY DEFINER function
--   scans the underlying table.
--
-- Scope:
--   - Creates public.is_team_member(uuid) helper function.
--   - Drops and recreates teams_select_member and team_members_select_member ONLY.
--   - All other policies, indexes, constraints, triggers, and grants are untouched.
--
-- Rollback (run manually if needed — do NOT include in a forward migration):
-- -----------------------------------------------------------------------------
-- Note: the rollback below restores the policy predicates verbatim but does NOT
-- restore the original explanatory comments (the "RLS self-reference note" blocks
-- at lines 594-602 and 733-740 of 20260809000001_teams_schema.sql). Those
-- comments made a factually false claim about PostgreSQL RLS re-entry semantics
-- and are intentionally omitted. If a maintainer needs the original file byte-
-- exactly, recover it from git history (git show <commit>:supabase/migrations/
-- 20260809000001_teams_schema.sql) rather than relying on this stub.
-- -----------------------------------------------------------------------------
-- DROP POLICY IF EXISTS teams_select_member ON public.teams;
-- DROP POLICY IF EXISTS team_members_select_member ON public.team_members;
-- DROP FUNCTION IF EXISTS public.is_team_member(uuid);
--
-- CREATE POLICY teams_select_member
--   ON public.teams
--   FOR SELECT
--   TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1
--       FROM   public.team_members tm
--       WHERE  tm.team_id    = id
--         AND  tm.profile_id = auth.uid()
--     )
--   );
--
-- CREATE POLICY team_members_select_member
--   ON public.team_members
--   FOR SELECT
--   TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1
--       FROM   public.team_members tm_self
--       WHERE  tm_self.team_id    = team_id
--         AND  tm_self.profile_id = auth.uid()
--     )
--   );
-- -----------------------------------------------------------------------------
-- WARNING: rolling back restores the recursive policies and will re-introduce
-- the infinite-recursion error. Only roll back if you are immediately dropping
-- the teams module entirely.
-- =============================================================================


-- =============================================================================
-- 1. SECURITY DEFINER helper: public.is_team_member(uuid)
--
-- Returns true if the currently authenticated user (auth.uid()) holds a row in
-- public.team_members for the given team_id. Because this function is SECURITY
-- DEFINER, PostgreSQL executes it under the privileges of the function owner
-- (the postgres/superuser role) rather than the calling session. This means RLS
-- is NOT applied to the SELECT inside the function body, breaking the recursion
-- path that caused the infinite-recursion error.
--
-- STABLE (not VOLATILE): the result is constant within a single SQL statement
-- for a given input — the same user/team pair will not change mid-statement.
-- This allows the planner to cache and reuse the result across rows in a scan,
-- which is important for the team_members_select_member policy that is evaluated
-- once per row in the table.
--
-- search_path = '': prevents search_path hijacking. All object references inside
-- must be fully schema-qualified (public.team_members, auth.uid()). This is the
-- established project convention for every SECURITY DEFINER function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_team_member(_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.team_members
    WHERE  team_id    = _team_id
      AND  profile_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_team_member(uuid) IS
  'Returns true if the calling session''s user (auth.uid()) has a row in '
  'public.team_members for the given team_id. '
  'SECURITY DEFINER is required: the function must bypass RLS on team_members '
  'to prevent infinite recursion. Any RLS policy on team_members that calls this '
  'helper would re-enter that same policy if the lookup were subject to RLS — '
  'causing PostgreSQL to detect infinite recursion and abort the statement. '
  'Running as the function owner (a superuser role) means the SELECT inside sees '
  'the raw table without policy evaluation.';

-- Lock down the execution surface.
-- Revoke from PUBLIC first (implicit grant that all functions receive on creation),
-- then grant only to the authenticated role — the role that RLS policies run under
-- for anon-key sessions. Service-role bypasses RLS entirely and does not need this
-- function. anon role has no grants on business tables, so no grant needed there.
REVOKE ALL ON FUNCTION public.is_team_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid) TO authenticated;


-- =============================================================================
-- 2. Replace teams_select_member
--
-- Original policy (20260809000001, lines 603-614): EXISTS subquery read
-- public.team_members inline. Under normal circumstances this is safe for a
-- policy on public.teams. However, once team_members_select_member caused
-- recursion, any evaluation path that touched team_members cascaded into it.
--
-- New policy: delegates the membership check to is_team_member(), which bypasses
-- RLS on team_members entirely. Behavior is identical: an employee sees a teams
-- row if and only if they have a team_members row for that team. No behavior change.
-- =============================================================================

DROP POLICY IF EXISTS teams_select_member ON public.teams;

CREATE POLICY teams_select_member
  ON public.teams
  FOR SELECT
  TO authenticated
  USING (
    public.is_team_member(id)  -- id = teams.id (current row being evaluated)
  );


-- =============================================================================
-- 3. Replace team_members_select_member
--
-- Original policy (20260809000001, lines 741-752): EXISTS subquery read
-- public.team_members (tm_self) — the same table this policy is defined on.
-- PostgreSQL re-enters all active permissive SELECT policies when a subquery
-- inside a policy expression touches the same table, including the policy
-- currently being evaluated. This produces the "infinite recursion detected in
-- policy for relation team_members" runtime error.
--
-- New policy: delegates the membership check to is_team_member(), which bypasses
-- RLS on team_members. Behavior is identical: an employee sees a team_members row
-- (for any member of a team) if and only if they themselves are also a member of
-- that team. This preserves FR-07 (employees can see fellow team members).
-- =============================================================================

DROP POLICY IF EXISTS team_members_select_member ON public.team_members;

CREATE POLICY team_members_select_member
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    -- team_id = team_members.team_id (current row being evaluated).
    -- Returns true if the calling user is a member of the same team, which means
    -- they are permitted to see this membership row (and thus the fellow member).
    public.is_team_member(team_id)
  );
