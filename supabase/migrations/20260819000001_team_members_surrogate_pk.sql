-- =============================================================================
-- Migration: 20260819000001_team_members_surrogate_pk.sql
-- Purpose:   Prerequisite structural changes for the employee lifecycle and
--            tombstone deletion model (PRD 05).
--
--            This migration makes two independent but coupled schema changes
--            that MUST ship atomically before the deletion RPCs go live:
--
--            1. team_members surrogate UUID primary key (RD-03)
--               The original composite PK (team_id, profile_id) cannot contain
--               NULL values. Since PRD 05 requires profile_id to become nullable
--               (ON DELETE SET NULL — tombstone-first design), the composite PK
--               must be replaced by a surrogate UUID PK. The (team_id, profile_id)
--               pair is demoted to a plain UNIQUE constraint (PostgreSQL default
--               NULLS DISTINCT behavior). NULLS DISTINCT means multiple tombstone
--               rows (profile_id = NULL) per team are permitted — each NULL is
--               treated as distinct from every other NULL. Live membership
--               uniqueness is still enforced: all live rows have non-null
--               profile_id and PostgreSQL still rejects two identical non-null
--               pairs. This removes the one-tombstone-per-team admin-UX burden
--               without weakening correctness. The FK constraint (not this UNIQUE)
--               prevents duplicate live memberships in any race scenario.
--
--            2. boards.created_by column (reviewer finding B-2)
--               The boards table does not currently carry a created_by column.
--               This migration adds it as UUID NULL with ON DELETE SET NULL so
--               that when a profile is hard-deleted, boards they created become
--               tombstones rather than blocking the deletion (which a RESTRICT FK
--               would do) or disappearing entirely (which a CASCADE would do).
--               Existing rows receive created_by = NULL — there is no reliable
--               way to infer historical creators from the migration context.
--
-- Why these two changes are coupled:
--   The hard_delete_employee RPC (in the next migration) deletes a profiles row.
--   PostgreSQL evaluates ON DELETE actions BEFORE committing the delete. If
--   team_members.profile_id still had ON DELETE CASCADE at that point, the
--   membership rows would vanish with the profile — destroying the tombstone data
--   that FR-15 requires. This migration switches the FK to ON DELETE SET NULL and
--   adds the surrogate PK that makes nullable profile_id valid.
--
--   Without this migration deployed first, the deletion RPCs in
--   20260819000002_employee_lifecycle_deletion.sql cannot work correctly.
--   Deploy order: this migration → then 20260819000002. They cannot be reversed
--   independently after both are live (see rollback note below).
--
-- Rollback considerations (dev/staging ONLY — NEVER on production with live data):
--   Reversing this migration after 20260819000002 is applied requires rolling
--   back 20260819000002 FIRST. The RPCs in that migration call internal functions
--   that assume the team_members surrogate PK and boards.created_by column exist.
--   Rollback sequence:
--     1. Roll back 20260819000002 (DROP all RPCs, log table, deletion_scheduled_at)
--     2. Roll back this migration:
--          ALTER TABLE public.team_members DROP COLUMN IF EXISTS id;
--          ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_team_profile_unique;
--          ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_profile_id_fkey;
--          ALTER TABLE public.team_members
--            ADD CONSTRAINT team_members_pkey PRIMARY KEY (team_id, profile_id);
--          ALTER TABLE public.team_members
--            ADD CONSTRAINT team_members_profile_id_fkey
--              FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
--              ON DELETE CASCADE ON UPDATE CASCADE;
--          ALTER TABLE public.team_members ALTER COLUMN profile_id SET NOT NULL;
--          ALTER TABLE public.boards DROP COLUMN IF EXISTS created_by;
--
-- Tenancy note:
--   Both team_members and boards already carry company_id. No tenancy changes here.
--   The surrogate PK is a structural change only — RLS policies on team_members
--   are NOT changed by this migration (they filter on profile_id and team_id,
--   not on the PK column id, so they remain correct after this restructure).
--
-- Dependencies:
--   20260802000001_auth_schema.sql  — public.profiles
--   20260809000001_teams_schema.sql — public.team_members, public.boards
--   20260818000001_grant_service_role_table_privileges.sql — default privileges
-- =============================================================================


-- =============================================================================
-- PART 1: team_members surrogate UUID primary key (RD-03)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1a. Add the surrogate UUID primary key column.
--
-- We use ADD COLUMN IF NOT EXISTS for idempotency. DEFAULT gen_random_uuid()
-- means existing rows immediately receive a unique UUID without any data
-- migration step. New rows will also receive a UUID automatically.
--
-- We cannot use ADD COLUMN ... PRIMARY KEY directly while the composite PK
-- still exists. We add the column first, then swap the PK constraint below.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.team_members.id IS
  'Surrogate UUID primary key. Added in 20260819000001 to replace the composite '
  'PK (team_id, profile_id) which cannot contain NULL values. NULL profile_id '
  'values represent tombstone rows (deleted employees) per PRD 05 FR-15.';


-- ---------------------------------------------------------------------------
-- Step 1b. Drop the existing composite primary key.
--
-- The composite PK (team_id, profile_id) enforced uniqueness of the membership
-- pair and prevented NULL in either column. We are replacing it with:
--   - A surrogate UUID PK on the new `id` column.
--   - A UNIQUE constraint on (team_id, profile_id) — default NULLS DISTINCT.
--
-- Dropping the composite PK does NOT drop the team_members_team_id_fkey or
-- team_members_profile_id_fkey FK constraints — those are separate objects.
-- The idx_team_members_profile_id_team_id index is also untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_pkey;


-- ---------------------------------------------------------------------------
-- Step 1c. Add the surrogate UUID primary key on the new id column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


-- ---------------------------------------------------------------------------
-- Step 1d. Add UNIQUE constraint on (team_id, profile_id) — NULLS DISTINCT (default).
--
-- PostgreSQL default (NULLS DISTINCT) behavior:
--   NULL values are never equal to each other in a UNIQUE constraint. Two rows
--   with (team_id, NULL) do NOT violate the constraint. This allows multiple
--   tombstone rows for the same team — each tombstone represents a distinct
--   deleted member and all are retained for admin cleanup without restriction.
--
-- Why NULLS DISTINCT (not NULLS NOT DISTINCT):
--   The reviewer noted that NULLS NOT DISTINCT imposes a one-tombstone-per-team
--   admin-UX burden that is not required for correctness. Live membership
--   uniqueness (no two live members with the same profile_id in the same team)
--   is enforced because all live rows have non-null profile_id values, and
--   PostgreSQL still rejects two identical non-null (team_id, profile_id) pairs.
--   The FK constraint (ON DELETE SET NULL) — not this UNIQUE constraint — is
--   what prevents duplicate live memberships in race scenarios.
--
--   With NULLS DISTINCT:
--     - Multiple tombstone rows per team are allowed (unbounded).
--     - Each represents a distinct deleted employee's slot.
--     - Admins can remove them at their own pace; no ordering constraint.
--     - Live membership uniqueness is unchanged (non-null pairs still unique).
--
-- NULLS DISTINCT is the PostgreSQL default and is written as a plain
-- UNIQUE constraint (no extra clause needed).
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_team_profile_unique
    UNIQUE (team_id, profile_id);

COMMENT ON CONSTRAINT team_members_team_profile_unique ON public.team_members IS
  'Replaces the former composite PK. Default NULLS DISTINCT behavior: multiple '
  'tombstone rows (profile_id = NULL) per team are permitted — each represents '
  'a distinct deleted member slot. Live membership uniqueness (no duplicate live '
  'members) is still enforced because live rows always have non-null profile_id. '
  'PRD 05 RD-03. Reviewer SF-2: NULLS DISTINCT preferred over NULLS NOT DISTINCT '
  'for better admin UX (no one-tombstone-per-team ordering constraint).';


-- ---------------------------------------------------------------------------
-- Step 1e. Allow NULL in team_members.profile_id.
--
-- The composite PK previously implied NOT NULL on both columns. Now that the
-- surrogate PK is in place, we can relax profile_id to nullable. This is
-- required so the FK ON DELETE SET NULL action (Step 1f) can write NULL here
-- when a profile is deleted.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  ALTER COLUMN profile_id DROP NOT NULL;


-- ---------------------------------------------------------------------------
-- Step 1f. Recreate the profile_id FK with ON DELETE SET NULL.
--
-- Current FK (from 20260809000001):
--   team_members_profile_id_fkey FOREIGN KEY (profile_id)
--     REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
--
-- New FK:
--   ON DELETE SET NULL — when a profiles row is deleted, the referencing
--     team_members.profile_id is set to NULL rather than the row being deleted.
--     This preserves the team membership slot as a tombstone (FR-15).
--   ON UPDATE CASCADE — retained for defensive consistency (UUIDs do not
--     normally change, but the pattern is consistent with other FKs).
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_profile_id_fkey;

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

COMMENT ON CONSTRAINT team_members_profile_id_fkey ON public.team_members IS
  'ON DELETE SET NULL — profile deletion sets profile_id to NULL (tombstone), '
  'preserving the membership row for admin cleanup. Changed from ON DELETE '
  'CASCADE in 20260819000001 per PRD 05 FR-15 (tombstone-first design, RD-03).';


-- =============================================================================
-- PART 2: Update check_team_member_company_match trigger (RD-03 consequence)
--
-- The existing trigger function reads profiles.company_id for NEW.profile_id
-- to enforce the cross-company membership invariant. Now that profile_id can
-- be NULL (for tombstone inserts), the trigger must short-circuit when
-- profile_id IS NULL — a tombstone row does not have a company to check against,
-- and tombstone inserts should not occur via normal application paths anyway
-- (they are produced by the FK ON DELETE SET NULL action, not by direct INSERT).
--
-- The trigger fires on INSERT only (not UPDATE — membership rows are
-- insert/delete only). Tombstone rows are never directly inserted; they result
-- from the FK SET NULL side-effect of a profile deletion. So this guard is
-- defensive — it prevents a confused future caller from inserting a tombstone
-- row directly and hitting a NULL dereference in the company_id lookup.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_team_member_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER                 -- bypass RLS on parent tables for invariant check
SET search_path = ''             -- prevent search_path injection; all refs schema-qualified
AS $$
DECLARE
  v_team_company_id    uuid;
  v_profile_company_id uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- RD-03 addition: short-circuit for tombstone rows.
  -- A NULL profile_id means this is a tombstone insert (produced by the FK
  -- ON DELETE SET NULL action). The cross-company check does not apply because
  -- there is no profile to check against. Return NEW immediately.
  --
  -- Note: tombstone rows are NOT produced by direct INSERT from application
  -- code — they are the side-effect of PostgreSQL's FK ON DELETE SET NULL
  -- action when a profile row is deleted. This guard is purely defensive for
  -- any hypothetical future path that inserts a NULL-profile_id row directly.
  -- -------------------------------------------------------------------------
  IF NEW.profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Retrieve the company of the team being joined.
  -- SECURITY DEFINER ensures this SELECT is not filtered by RLS, so we see
  -- the real company_id even when the calling session's RLS would hide the row.
  SELECT company_id
  INTO   v_team_company_id
  FROM   public.teams
  WHERE  id = NEW.team_id;

  -- Retrieve the company of the profile being added.
  -- Same SECURITY DEFINER bypass applies here.
  SELECT company_id
  INTO   v_profile_company_id
  FROM   public.profiles
  WHERE  id = NEW.profile_id;

  -- Belt-and-suspenders: raise a distinct error if either FK target is genuinely
  -- absent. The FK constraints above will also catch this, but this check fires
  -- earlier and produces a more informative message. Error code is
  -- foreign_key_violation (23503) to signal a referential integrity problem.
  IF v_team_company_id IS NULL OR v_profile_company_id IS NULL THEN
    RAISE EXCEPTION
      'team_members cross-company guard: team or profile not found (team_id=%, profile_id=%)',
      NEW.team_id, NEW.profile_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Core invariant: profile must belong to the same company as the team.
  -- With SECURITY DEFINER this branch is now reliably reached even when the
  -- calling session's RLS would hide the team row.
  IF v_team_company_id <> v_profile_company_id THEN
    RAISE EXCEPTION
      'Cross-company team membership is not allowed: team belongs to company %, profile belongs to company %',
      v_team_company_id, v_profile_company_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_team_member_company_match() IS
  'BEFORE INSERT trigger on team_members. SECURITY DEFINER so it can read teams '
  'and profiles without RLS interference. Updated in 20260819000001 (PRD 05 RD-03) '
  'to short-circuit when NEW.profile_id IS NULL — tombstone rows (created by FK '
  'ON DELETE SET NULL when a profile is deleted) bypass the company-match check '
  'because there is no profile row to validate against. This is correct behavior: '
  'tombstone rows are not cross-company membership attempts; they are the preserved '
  'membership slot of a deleted employee.';

-- The trigger attachment (team_members_company_match_check) was created in
-- 20260809000001 and is still valid — it fires BEFORE INSERT on team_members.
-- CREATE OR REPLACE FUNCTION above updates the function body in-place without
-- needing to drop and recreate the trigger itself.


-- =============================================================================
-- PART 3: boards.created_by column (reviewer finding B-2)
--
-- The boards table was created in 20260809000001 without a created_by column.
-- PRD 05 RD-04 specifies that all boards created by a deleted employee should
-- become tombstones (created_by set to NULL) rather than being deleted or
-- blocking the employee's deletion.
--
-- This column:
--   - Is UUID NULL (not NOT NULL — existing rows cannot be retroactively
--     attributed to a creator; NULL means "unknown / created before this column
--     was added or admin-created via RPC").
--   - References public.profiles(id) with ON DELETE SET NULL — when the creator's
--     profile is deleted, created_by becomes NULL (tombstone-first design, RD-04).
--   - Has no ON UPDATE cascade because UUIDs do not change.
--   - Is NOT included in the boards_company_id_match_check trigger since it
--     carries no company_id — no trigger update needed.
--
-- Backfill note: existing rows (boards created before this migration) will have
-- created_by = NULL. There is no reliable way to infer historical creators from
-- the migration context alone. The boards were created via the create_team_with_board
-- RPC which did not capture creator identity. Future writes to created_by are the
-- responsibility of the caller (the create_team_with_board RPC is the primary path
-- and should be updated by the backend agent to write auth.uid() at creation time).
--
-- Column-level grant: the authenticated role's current grants on boards are
-- SELECT (all columns) and UPDATE (name) — added in 20260809000001. The created_by
-- column should NOT be directly writable by the authenticated role. It should only
-- be written by SECURITY DEFINER RPCs (create_team_with_board) or by the FK
-- ON DELETE SET NULL action. No additional GRANT is needed; the absence of a
-- column-level UPDATE grant on created_by means it cannot be mutated from an
-- authenticated session.
-- =============================================================================
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS created_by uuid NULL;

-- Add the FK constraint only if it does not already exist.
-- Using DO block with pg_constraint lookup for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname    = 'boards_created_by_fkey'
      AND  conrelid   = 'public.boards'::regclass
  ) THEN
    ALTER TABLE public.boards
      ADD CONSTRAINT boards_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public.profiles (id)
        ON DELETE SET NULL;
        -- No ON UPDATE CASCADE: profile UUIDs do not change in practice.
        -- No ON DELETE RESTRICT: we want tombstone behavior, not blocking behavior.
  END IF;
END;
$$;

COMMENT ON COLUMN public.boards.created_by IS
  'Profile ID of the user who created this board. NULL for boards created '
  'before this column was added (20260819000001) and for boards whose creator '
  'has been hard-deleted. ON DELETE SET NULL implements tombstone-first design '
  '(PRD 05 RD-04): when the creator is deleted, the board is preserved with '
  'created_by = NULL for admin to manually reassign or archive. '
  'Written by the create_team_with_board RPC (backend agent must update it '
  'to pass auth.uid() at board creation time). Never writable directly from '
  'an authenticated client session (no column-level GRANT UPDATE on created_by). '
  'Intentional tombstone-first: all boards become tombstones on creator deletion; '
  'personal-board auto-deletion is deferred to post-MVP per RD-04.';

-- Index: boards queried by creator (expected query: "show me boards I created"
-- or admin filtering boards by employee before deletion).
-- Justification: when an admin views a deleted employee's profile for cleanup,
-- they will need to find boards owned by that employee. A partial index on
-- non-null created_by rows avoids scanning the entire boards table.
-- NULL rows (tombstones) are excluded via WHERE — they are not the target of
-- creator-based queries.
CREATE INDEX IF NOT EXISTS idx_boards_created_by
  ON public.boards (created_by)
  WHERE created_by IS NOT NULL;

COMMENT ON INDEX public.idx_boards_created_by IS
  'Supports lookup of boards by creator (admin cleanup workflow after employee '
  'deletion, future "my boards" filter). Partial index: excludes NULL rows '
  '(tombstones) since tombstone rows are not the target of creator-based queries. '
  'Added in 20260819000001 per PRD 05 RD-04 reviewer finding B-2.';


-- =============================================================================
-- Update table comment on team_members to document the schema evolution.
-- =============================================================================
COMMENT ON TABLE public.team_members IS
  'Join table: which profiles belong to which teams. '
  'Surrogate UUID primary key `id` (added 20260819000001, PRD 05 RD-03). '
  '(team_id, profile_id) UNIQUE (NULLS DISTINCT default) — replaces former composite PK. '
  'Multiple tombstone rows (profile_id = NULL) per team are allowed. '
  'profile_id is nullable: NULL rows are tombstones (deleted employee slot) '
  'preserved for admin cleanup per FR-15. FK: profile_id ON DELETE SET NULL '
  '(changed from ON DELETE CASCADE in 20260819000001). '
  'team_id FK: ON DELETE CASCADE — removing the team still removes all membership rows. '
  'RLS policies unchanged: NULL profile_id rows never match auth.uid() so deleted '
  'users do not gain accidental access through tombstone rows.';

-- =============================================================================
-- End of migration 20260819000001_team_members_surrogate_pk.sql
-- =============================================================================
