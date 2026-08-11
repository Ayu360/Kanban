-- =============================================================================
-- Migration: 20260809000001_teams_schema.sql
-- Purpose:   Teams module database layer — teams, team_members, boards, columns
--            tables with constraints, indexes, RLS policies, and the atomic
--            team-creation RPC function.
--
-- Dependency: 20260802000001_auth_schema.sql (companies, profiles, handle_updated_at)
--             20260802000002_jwt_sync_hook.sql (JWT hook — custom_access_token_hook)
--
-- Domain model introduced:
--   companies → teams → team_members (join)
--                    → boards → columns
--
-- Rollback considerations (DESTRUCTIVE — dev/staging only):
--   DROP FUNCTION IF EXISTS public.create_team_with_board(uuid, text) CASCADE;
--   DROP FUNCTION IF EXISTS public.check_team_member_company_match() CASCADE;
--   DROP FUNCTION IF EXISTS public.check_board_company_id_match() CASCADE;
--   DROP FUNCTION IF EXISTS public.check_column_company_id_match() CASCADE;
--   DROP TABLE IF EXISTS public.columns CASCADE;
--   DROP TABLE IF EXISTS public.boards CASCADE;
--   DROP TABLE IF EXISTS public.team_members CASCADE;
--   DROP TABLE IF EXISTS public.teams CASCADE;
--   Never run on production without a full data backup.
--
-- Tenancy (ADR-0006):
--   Every table introduced here carries company_id NOT NULL FK → companies.
--   All unique constraints are company-scoped.
--   RLS policies filter on JWT company_id by default; platform-admin bypass
--   and company-admin bypass follow the established three-tier pattern (ADR-0008,
--   ADR-0009).
--
-- Tasks note:
--   The `tasks` table (columns → tasks) does not yet exist as of this migration.
--   Cascade from columns to tasks must be added in the tasks migration.
--   See docs/handoffs/database-to-backend-teams.md for the integration contract.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. teams
--
-- Design decisions:
--   - UUID primary key per project convention.
--   - company_id NOT NULL FK → companies (ADR-0006). ON DELETE RESTRICT: a
--     company cannot be dropped while teams reference it (protects data).
--   - name TEXT (not varchar) per project principle.
--   - CHECK (char_length(trim(name)) > 0): non-empty after trimming whitespace.
--   - CHECK (char_length(name) <= 100): PRD max-length rule enforced at DB level.
--   - Case-insensitive uniqueness within a company is enforced via an expression
--     unique index on (company_id, lower(trim(name))). A plain UNIQUE constraint
--     on (company_id, name) would allow "Engineering" and "engineering" to
--     coexist. The expression index approach avoids the citext extension (not
--     currently installed) and is consistent with the project's text-column
--     conventions. Under concurrent inserts the index acts as the serialization
--     point — the second identical insert receives a unique-violation error from
--     PostgreSQL itself, not from application logic.
--   - created_at / updated_at: standard timestamptz defaults + trigger.
--
-- Multi-tenancy:
--   company_id is present and non-nullable from day one. Unique constraint
--   on (company_id, lower(trim(name))) is correct for multi-tenant uniqueness.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT teams_pkey
    PRIMARY KEY (id),

  CONSTRAINT teams_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  -- Non-empty after trimming whitespace (mirrors companies_name_check convention)
  CONSTRAINT teams_name_nonempty_check
    CHECK (char_length(trim(name)) > 0),

  -- Maximum 100 characters per PRD validation rule
  CONSTRAINT teams_name_maxlen_check
    CHECK (char_length(name) <= 100)
);

COMMENT ON TABLE  public.teams             IS 'Organizational groupings within a company. Each team owns exactly one board. ADR-0006, ADR-0009.';
COMMENT ON COLUMN public.teams.id          IS 'Surrogate UUID primary key.';
COMMENT ON COLUMN public.teams.company_id  IS 'Tenant scope. Non-nullable per ADR-0006. FK to companies.';
COMMENT ON COLUMN public.teams.name        IS 'Human-readable team name. Non-empty, max 100 chars, unique within company (case-insensitive). See idx_teams_company_id_name_lower.';

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. team_members
--
-- Design decisions:
--   - Composite primary key (team_id, profile_id) per PRD.
--   - team_id FK → teams ON DELETE CASCADE: removing a team removes all
--     membership rows automatically. This is the correct cascade per PRD FR-03.
--   - profile_id FK → profiles ON DELETE CASCADE: removing a profile (when the
--     auth.users row is deleted) cleans up membership. Prevents orphaned rows.
--   - ON UPDATE CASCADE for both FKs so UUID changes propagate (defensive; UUIDs
--     don't normally change but the pattern is consistent with profiles FK).
--   - created_at: records when membership was established. No updated_at needed
--     because membership rows are insert/delete only — there is nothing to update.
--   - No role column in MVP per PRD Non-Goals. Can be added later without
--     breaking any existing relationship.
--   - Cross-company membership prevention: enforced by the trigger function
--     check_team_member_company_match (defined below). A pure CHECK constraint
--     cannot reference another table row in standard PostgreSQL. A trigger is
--     the correct database-layer enforcement mechanism.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_members (
  team_id     uuid        NOT NULL,
  profile_id  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_members_pkey
    PRIMARY KEY (team_id, profile_id),

  CONSTRAINT team_members_team_id_fkey
    FOREIGN KEY (team_id)
    REFERENCES public.teams (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT team_members_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

COMMENT ON TABLE  public.team_members            IS 'Join table: which profiles belong to which teams. Composite PK (team_id, profile_id). ADR-0009.';
COMMENT ON COLUMN public.team_members.team_id    IS 'FK to teams. ON DELETE CASCADE — removing the team removes all membership rows.';
COMMENT ON COLUMN public.team_members.profile_id IS 'FK to profiles. ON DELETE CASCADE — removing a user removes their team memberships.';
COMMENT ON COLUMN public.team_members.created_at IS 'When the employee was added to the team.';

-- ---------------------------------------------------------------------------
-- 3. boards
--
-- Design decisions:
--   - UUID primary key.
--   - team_id FK → teams ON DELETE CASCADE: deleting a team cascades to the
--     board, which cascades to columns, which will cascade to tasks (when
--     the tasks migration is applied). This is the full cascade chain.
--   - UNIQUE(team_id): enforces the one-board-per-team invariant at the database
--     level. A second INSERT attempting to create a board for the same team
--     gets a unique-violation error regardless of application logic.
--   - company_id NOT NULL FK → companies per ADR-0006. ON DELETE RESTRICT.
--   - name TEXT, not nullable. Default name "Team Board" is applied by the
--     create_team_with_board RPC function, not by a column default, because
--     the board name is semantically tied to team creation context.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.boards (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT boards_pkey
    PRIMARY KEY (id),

  CONSTRAINT boards_team_id_fkey
    FOREIGN KEY (team_id)
    REFERENCES public.teams (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT boards_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  -- One board per team — the core MVP invariant. Concurrent INSERTs for the
  -- same team_id will serialize on this constraint; the second will fail.
  CONSTRAINT boards_team_id_unique
    UNIQUE (team_id),

  CONSTRAINT boards_name_nonempty_check
    CHECK (char_length(trim(name)) > 0)
);

COMMENT ON TABLE  public.boards            IS 'Kanban boards. One per team (UNIQUE team_id). ADR-0009. Belongs to team → company.';
COMMENT ON COLUMN public.boards.team_id    IS 'FK to teams. UNIQUE — enforces one-board-per-team MVP invariant.';
COMMENT ON COLUMN public.boards.company_id IS 'Tenant scope redundancy. Non-nullable per ADR-0006. Consistency with teams.company_id enforced by check_board_company_id_match trigger.';
COMMENT ON COLUMN public.boards.name       IS 'Board display name. Set by create_team_with_board RPC.';

CREATE TRIGGER boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 4. columns
--
-- Design decisions:
--   - UUID primary key.
--   - board_id FK → boards ON DELETE CASCADE: board deletion removes all columns.
--     This is step 3 of the team-deletion cascade chain.
--   - company_id NOT NULL FK → companies per ADR-0006. ON DELETE RESTRICT.
--   - title TEXT, non-empty check.
--   - position INTEGER NOT NULL, positive check. Seeded values are 1, 2, 3.
--     No UNIQUE(board_id, position) constraint in MVP because column reordering
--     (a future feature) would require swapping positions atomically. The PRD
--     does not require unique positions in MVP. A partial approach would add
--     complexity without current benefit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.columns (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  board_id    uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  title       text        NOT NULL,
  position    integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT columns_pkey
    PRIMARY KEY (id),

  CONSTRAINT columns_board_id_fkey
    FOREIGN KEY (board_id)
    REFERENCES public.boards (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT columns_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT columns_title_nonempty_check
    CHECK (char_length(trim(title)) > 0),

  -- Position must be a positive integer (PRD validation rule)
  CONSTRAINT columns_position_positive_check
    CHECK (position > 0)
);

COMMENT ON TABLE  public.columns            IS 'Ordered columns within a board (e.g. Todo, In Progress, Done). ON DELETE CASCADE from boards.';
COMMENT ON COLUMN public.columns.board_id   IS 'FK to boards. ON DELETE CASCADE — board deletion removes all columns.';
COMMENT ON COLUMN public.columns.company_id IS 'Tenant scope per ADR-0006. Denormalized for RLS performance (avoids join to boards for tenant check). Consistency with boards.company_id enforced by check_column_company_id_match trigger.';
COMMENT ON COLUMN public.columns.position   IS 'Display order within the board. Positive integer. Seeded values: 1=Todo, 2=In Progress, 3=Done.';
COMMENT ON COLUMN public.columns.title      IS 'Column label. Non-empty after trimming.';

CREATE TRIGGER columns_updated_at
  BEFORE UPDATE ON public.columns
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- 5. Cross-company membership guard trigger (M-2 fix: now SECURITY DEFINER)
--
-- Problem: A CHECK constraint cannot reference another table. PostgreSQL has
-- no declarative cross-table integrity constraint for this invariant. We must
-- use a BEFORE INSERT trigger to enforce: profile.company_id = team.company_id.
--
-- Why SECURITY DEFINER is used here (M-2 fix):
--   Without SECURITY DEFINER, the trigger function runs with the privileges
--   of the invoking session (INVOKER semantics). That means the SELECT on
--   public.teams and public.profiles is subject to RLS. When RLS hides the
--   target team (e.g. because the calling user is a company-A admin attempting
--   to insert a member into a company-B team), the SELECT returns NULL and
--   the trigger falls into the "team or profile not found" branch, raising
--   foreign_key_violation instead of the precise check_violation intended
--   for the cross-company case. Using SECURITY DEFINER ensures the trigger
--   can always read the underlying company_id columns from both tables to
--   distinguish the two error conditions correctly.
--
--   Minimal-privilege justification: the trigger reads exactly two columns
--   (company_id) from exactly two tables (teams, profiles). No writes. No
--   other side effects. search_path = '' prevents any search_path hijacking.
--   EXECUTE on trigger functions is not granted to any non-postgres role —
--   trigger functions are called by the trigger infrastructure, not by users.
--
-- Error distinction after fix:
--   - Genuinely missing team or profile  → foreign_key_violation (23503)
--     (belt-and-suspenders; FK constraints also catch this, but we check early
--     for a more informative error message)
--   - Cross-company membership attempt   → check_violation (23514)
--     This is now reliably raised even when RLS would hide the target team,
--     because SECURITY DEFINER bypasses RLS for the internal SELECTs.
--
-- Note: EXECUTE on trigger functions does not need to be granted to the
-- invoking user. PostgreSQL calls trigger functions automatically via the
-- trigger infrastructure using the function owner's privileges (SECURITY
-- DEFINER). No GRANT EXECUTE to authenticated or service_role is needed
-- or appropriate for trigger functions.
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
  -- calling session's RLS would hide the team row. Previously (INVOKER mode),
  -- a cross-company attempt by a company-A admin would hit the NULL branch
  -- above with the wrong error code.
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
  'BEFORE INSERT trigger on team_members. SECURITY DEFINER so it can read teams and profiles without RLS interference — needed to distinguish a genuine missing-row error (foreign_key_violation 23503) from a cross-company membership attempt (check_violation 23514). Without SECURITY DEFINER, RLS hides the target team row during cross-company attempts, causing the trigger to raise the wrong error code. Minimal privilege: reads only company_id from teams and profiles; no writes, no other tables.';

-- Attach the trigger. Fires on INSERT only (there is no UPDATE — membership
-- rows are insert/delete only; the composite PK has no updatable FK column).
CREATE TRIGGER team_members_company_match_check
  BEFORE INSERT ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.check_team_member_company_match();

-- =============================================================================
-- 5b. boards company_id consistency trigger (M-1 fix)
--
-- Purpose: Assert that boards.company_id always equals the company_id of the
-- team the board belongs to. This column is denormalized onto boards for RLS
-- performance — if it drifts from teams.company_id, tenant isolation breaks.
--
-- Why this is needed:
--   The RPC create_team_with_board is the sole INSERT path today, so the values
--   are always consistent. But denormalized company_id is the RLS enforcement
--   column on boards; any future direct INSERT or UPDATE (including from a
--   service-role migration or a future feature) could silently produce drift.
--   A trigger is the only PostgreSQL mechanism that can enforce a cross-table
--   equality invariant. This trigger converts silent drift into a hard error
--   that must be fixed before the operation succeeds.
--
-- Why SECURITY DEFINER:
--   The trigger reads public.teams.company_id during INSERT and UPDATE. If this
--   trigger ran as INVOKER, a service-role migration (which bypasses RLS) could
--   still be affected by RLS in a future configuration change. More importantly,
--   using SECURITY DEFINER makes the enforcement unconditional and consistent
--   regardless of the calling session's role — the same safe pattern used for
--   check_team_member_company_match.
--
-- search_path = '': prevents search_path injection; all refs are schema-qualified.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_board_company_id_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_team_company_id uuid;
BEGIN
  -- Look up the company_id of the parent team.
  -- SECURITY DEFINER ensures RLS does not filter this lookup.
  SELECT company_id
  INTO   v_team_company_id
  FROM   public.teams
  WHERE  id = NEW.team_id;

  IF v_team_company_id IS NULL THEN
    -- The FK constraint on boards.team_id will also catch this, but we raise
    -- an explicit error here for a more informative message.
    RAISE EXCEPTION
      'boards company_id consistency guard: team not found (team_id=%)',
      NEW.team_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.company_id <> v_team_company_id THEN
    RAISE EXCEPTION
      'boards.company_id (%) must equal teams.company_id (%) for team_id=%',
      NEW.company_id, v_team_company_id, NEW.team_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_board_company_id_match() IS
  'BEFORE INSERT OR UPDATE trigger on boards. Asserts boards.company_id = teams.company_id for the board''s parent team. Prevents tenant isolation drift when the denormalized company_id is written incorrectly. SECURITY DEFINER for unconditional enforcement regardless of calling session. ADR-0006.';

CREATE TRIGGER boards_company_id_match_check
  BEFORE INSERT OR UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.check_board_company_id_match();

-- =============================================================================
-- 5c. columns company_id consistency trigger (M-1 fix)
--
-- Purpose: Assert that columns.company_id always equals the company_id of the
-- board the column belongs to (which in turn equals the team's company_id).
-- Same motivation and design rationale as check_board_company_id_match.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_column_company_id_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_board_company_id uuid;
BEGIN
  -- Look up the company_id of the parent board.
  SELECT company_id
  INTO   v_board_company_id
  FROM   public.boards
  WHERE  id = NEW.board_id;

  IF v_board_company_id IS NULL THEN
    RAISE EXCEPTION
      'columns company_id consistency guard: board not found (board_id=%)',
      NEW.board_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.company_id <> v_board_company_id THEN
    RAISE EXCEPTION
      'columns.company_id (%) must equal boards.company_id (%) for board_id=%',
      NEW.company_id, v_board_company_id, NEW.board_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_column_company_id_match() IS
  'BEFORE INSERT OR UPDATE trigger on columns. Asserts columns.company_id = boards.company_id for the column''s parent board. Prevents tenant isolation drift on the denormalized company_id column. SECURITY DEFINER for unconditional enforcement. ADR-0006.';

CREATE TRIGGER columns_company_id_match_check
  BEFORE INSERT OR UPDATE ON public.columns
  FOR EACH ROW EXECUTE FUNCTION public.check_column_company_id_match();

-- =============================================================================
-- 6. Indexes
--
-- Query patterns justified for each index:
-- =============================================================================

-- P1. Case-insensitive unique team name within a company.
--     This is the uniqueness enforcement index — without it the uniqueness rule
--     is not enforced. Also used by any query filtering on team name search.
--     Expression: lower(trim(name)) handles both case-folding and whitespace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_company_id_name_lower
  ON public.teams (company_id, lower(trim(name)));

COMMENT ON INDEX public.idx_teams_company_id_name_lower IS
  'Enforces case-insensitive unique team name within a company. Expression lower(trim(name)) prevents "Engineering" vs "engineering" duplicates under concurrent inserts. The leading company_id column also covers any WHERE company_id = ? query pattern (e.g. company admin team listing), making a separate single-column idx_teams_company_id redundant. M-3 fix: removed the redundant idx_teams_company_id.';

-- NOTE (M-3 fix): idx_teams_company_id has been removed from this migration.
-- PostgreSQL B-tree indexes support leading-column prefix scans, so any query
-- with WHERE company_id = ? is fully covered by the leading column of
-- idx_teams_company_id_name_lower above. A separate single-column index on
-- company_id alone would add write overhead with zero read benefit.

-- P2. team_members(profile_id, team_id) — primary RLS lookup index.
--     Every authenticated query on teams, boards, or columns for an employee
--     evaluates: EXISTS (SELECT 1 FROM team_members WHERE profile_id = auth.uid()
--     AND team_id = ...). This composite index covers that predicate with
--     profile_id as the leading column (the selectivity column in the predicate).
--     Justification from PRD Database Requirements and ADR-0009.
CREATE INDEX IF NOT EXISTS idx_team_members_profile_id_team_id
  ON public.team_members (profile_id, team_id);

COMMENT ON INDEX public.idx_team_members_profile_id_team_id IS
  'Supports RLS EXISTS checks for employee team-membership filtering on teams, boards, and columns. profile_id is the leading column (most selective in the RLS predicate). Required per PRD Database Requirements and ADR-0009.';

-- P3. boards(team_id) — for column RLS policy joins.
--     Column RLS must join boards to check the team_id (and therefore the
--     team_members relation). A targeted single-column index on boards.team_id
--     makes this join cheap. Also used by UNIQUE constraint lookup but the
--     unique index already provides that — this covers non-unique scan patterns
--     (e.g. SELECT board WHERE team_id = ?).
--     Note: boards_team_id_unique already creates a unique B-tree index on
--     team_id, so we do NOT create a second index. The unique constraint index
--     serves this query pattern. (PostgreSQL unique indexes are usable as
--     regular indexes.)
--     → No additional index created here; boards_team_id_unique already covers P3.

-- P4. columns(board_id) — list columns for a board.
--     Standard parent-child lookup: "give me all columns for this board."
--     Used by the board page query and by column RLS traversal.
CREATE INDEX IF NOT EXISTS idx_columns_board_id
  ON public.columns (board_id);

COMMENT ON INDEX public.idx_columns_board_id IS
  'Supports listing columns by board (board page query). Also traversed in column RLS to check board.team_id for the team-membership filter.';

-- P5. boards(company_id) — RLS company-admin bypass on boards.
--     Company admin bypass predicate: company_id = jwt.company_id AND role = admin.
--     Without this index, a full scan of boards would occur on every board query
--     for a company admin.
CREATE INDEX IF NOT EXISTS idx_boards_company_id
  ON public.boards (company_id);

COMMENT ON INDEX public.idx_boards_company_id IS
  'Supports boards RLS company-admin bypass: WHERE company_id = jwt.company_id AND role = admin.';

-- P6. columns(company_id) — RLS company-admin bypass on columns.
--     Mirrors the boards index. The company_id column on columns is denormalized
--     specifically to enable this fast bypass without joining up to boards.
CREATE INDEX IF NOT EXISTS idx_columns_company_id
  ON public.columns (company_id);

COMMENT ON INDEX public.idx_columns_company_id IS
  'Supports columns RLS company-admin bypass (same pattern as boards). company_id is denormalized on columns for this purpose per ADR-0006.';

-- P7. team_members(team_id) — list members of a team (admin view).
--     The PK composite index (team_id, profile_id) has team_id as leading
--     column, so team-centric lookups are already covered by the PK index.
--     → No additional index needed; team_members_pkey already covers team_id lookups.

-- =============================================================================
-- 7. Row Level Security — teams
--
-- Three-tier policy per ADR-0008, ADR-0009:
--   1. Platform admin: sees all teams across all companies.
--   2. Company admin: sees all teams in their own company.
--   3. Employee: sees only teams they have a team_members row for.
--
-- SELECT: three permissive policies (PostgreSQL ORs permissive policies).
-- INSERT: restricted to company admin (own company) and platform admin.
--         Employees cannot create teams. Service-role bypass is available for
--         the create_team_with_board RPC (SECURITY DEFINER).
-- UPDATE (rename): restricted to company admin (own company) and platform admin.
--         Per PRD FR-02, rename can be a client-side Supabase write scoped by RLS.
-- DELETE: Server Action using service-role is the canonical deletion path per
--         ADR-0015 (transactional cascade). We also provide an authenticated-role
--         DELETE policy for company admin / platform admin as a belt-and-suspenders
--         measure, but the Server Action will use service-role in practice.
-- =============================================================================
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- SELECT: platform admin sees all teams
CREATE POLICY teams_select_platform_admin
  ON public.teams
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- SELECT: company admin sees all teams in their company
CREATE POLICY teams_select_company_admin
  ON public.teams
  FOR SELECT
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- SELECT: employee sees only their own team memberships
-- EXISTS subquery uses idx_team_members_profile_id_team_id via profile_id leading column.
--
-- RLS self-reference note (L-2 fix): this policy's EXISTS subquery reads
-- public.team_members — the same table that this RLS policy is defined on.
-- PostgreSQL does NOT recursively re-enter the outer policy when evaluating
-- a subquery against the same table. The subquery executes as a plain table
-- scan of team_members without re-applying the team_members_select_member
-- policy as a filter, avoiding infinite recursion. This is documented
-- PostgreSQL behavior (see: Row Security Policies, "Notes" section in the
-- PostgreSQL manual). Future maintainers should not worry about recursion
-- here, but should be aware that this pattern is intentional and correct.
CREATE POLICY teams_select_member
  ON public.teams
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.team_members tm
      WHERE  tm.team_id    = id          -- teams.id (current row)
        AND  tm.profile_id = auth.uid()
    )
  );

-- INSERT: company admin can create teams in their own company only.
-- WITH CHECK ensures the row being inserted matches the caller's company.
CREATE POLICY teams_insert_company_admin
  ON public.teams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- INSERT: platform admin can create teams in any company.
CREATE POLICY teams_insert_platform_admin
  ON public.teams
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- UPDATE: company admin can rename teams in their own company.
-- USING: which rows are visible for update; WITH CHECK: what the row must look like after.
CREATE POLICY teams_update_company_admin
  ON public.teams
  FOR UPDATE
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  )
  WITH CHECK (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- UPDATE: platform admin can rename any team.
CREATE POLICY teams_update_platform_admin
  ON public.teams
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- DELETE: company admin can delete teams in their own company.
-- In practice, team deletion goes through a service-role Server Action for
-- transactional cascade (ADR-0015). This policy exists as a defense-in-depth
-- fallback for any direct client-key deletion attempt by an admin.
CREATE POLICY teams_delete_company_admin
  ON public.teams
  FOR DELETE
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- DELETE: platform admin can delete any team.
CREATE POLICY teams_delete_platform_admin
  ON public.teams
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- =============================================================================
-- 8. Row Level Security — team_members
--
-- Access model:
--   SELECT: employee can see their own membership rows AND rows for teams they
--           belong to (so they can see fellow members — FR-07).
--           Company admin can see all memberships within their company.
--           Platform admin sees all.
--   INSERT: company admin and platform admin only. Employees cannot add members.
--   DELETE: company admin and platform admin only. Employees cannot remove members.
--   UPDATE: no UPDATE policy (membership rows have no updatable columns).
--
-- Security note: The employee SELECT policy allows reading all membership rows
-- for teams they belong to. This is intentional per FR-07 — employees should be
-- able to see who else is on their team. If this is too broad, it can be narrowed
-- to profile_id = auth.uid() only with a separate migration.
-- =============================================================================
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- SELECT: platform admin sees all membership rows
CREATE POLICY team_members_select_platform_admin
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- SELECT: company admin sees all membership rows for teams in their company
CREATE POLICY team_members_select_company_admin
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.teams t
      WHERE  t.id         = team_id     -- team_members.team_id (current row)
        AND  t.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    )
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- SELECT: employee can read membership rows for teams they belong to.
-- This allows an employee to see the full member list of their own teams (FR-07).
-- The membership check for the employee themselves uses profile_id = auth.uid(),
-- and they also see other members of the same team via the team_id join.
--
-- RLS self-reference note (L-2 fix): The EXISTS subquery below reads
-- public.team_members (tm_self) — the same table this policy is defined on.
-- PostgreSQL RLS does NOT recursively re-evaluate this outer policy when
-- the subquery accesses the same table. The subquery scans team_members
-- directly without applying team_members_select_member as a filter again.
-- This is correct, documented PostgreSQL behavior and does not cause infinite
-- recursion. The idx_team_members_profile_id_team_id index covers this lookup
-- efficiently (profile_id as leading column).
CREATE POLICY team_members_select_member
  ON public.team_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.team_members tm_self
      WHERE  tm_self.team_id    = team_id      -- same team as current row
        AND  tm_self.profile_id = auth.uid()   -- and they are a member of it
    )
  );

-- INSERT: company admin can add members to teams in their company only.
-- The cross-company membership guard trigger (check_team_member_company_match)
-- provides an additional database-layer safety net beyond RLS.
CREATE POLICY team_members_insert_company_admin
  ON public.team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    AND EXISTS (
      SELECT 1
      FROM   public.teams t
      WHERE  t.id         = team_id     -- team_members.team_id (being inserted)
        AND  t.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    )
  );

-- INSERT: platform admin can add members to any team.
CREATE POLICY team_members_insert_platform_admin
  ON public.team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- DELETE: company admin can remove members from teams in their company.
CREATE POLICY team_members_delete_company_admin
  ON public.team_members
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    AND EXISTS (
      SELECT 1
      FROM   public.teams t
      WHERE  t.id         = team_id     -- team_members.team_id (current row)
        AND  t.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    )
  );

-- DELETE: platform admin can remove any member from any team.
CREATE POLICY team_members_delete_platform_admin
  ON public.team_members
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- No UPDATE policy: team_members rows are insert/delete only. The composite PK
-- prevents any meaningful UPDATE anyway (changing team_id or profile_id would
-- be semantically equivalent to delete + insert). Absence of UPDATE policy
-- blocks all direct UPDATE attempts from the anon-key path.

-- =============================================================================
-- 9. Row Level Security — boards
--
-- Three-tier policy per ADR-0009:
--   1. Platform admin bypass.
--   2. Company admin bypass (within their company_id).
--   3. Employee team-membership filter.
--
-- SELECT: all three tiers.
-- INSERT: handled exclusively by create_team_with_board RPC (SECURITY DEFINER).
--         The authenticated role should NOT be able to INSERT boards directly —
--         the one-board-per-team invariant and atomic creation are managed by
--         the RPC. We do NOT provide an authenticated INSERT policy for boards.
--         This prevents any client-side board creation attempt.
-- UPDATE: company admin + platform admin only (board rename — future feature).
--         Column-level UPDATE grant restricts what can be changed from the
--         authenticated role (see Grants section): only boards.name is writable.
--         Structural columns (team_id, company_id) cannot be mutated from any
--         authenticated session regardless of RLS policy (H-1 fix).
-- DELETE: handled by team deletion cascade (ON DELETE CASCADE from teams).
--         Direct authenticated-role deletion of a board row is not a supported
--         operation in MVP. No authenticated DELETE policy.
-- =============================================================================
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

-- SELECT: platform admin
CREATE POLICY boards_select_platform_admin
  ON public.boards
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- SELECT: company admin sees all boards in their company
CREATE POLICY boards_select_company_admin
  ON public.boards
  FOR SELECT
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- SELECT: employee sees boards of teams they belong to
-- This is the core ADR-0009 policy shape.
CREATE POLICY boards_select_member
  ON public.boards
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.team_members tm
      WHERE  tm.team_id    = team_id      -- boards.team_id (current row)
        AND  tm.profile_id = auth.uid()
    )
  );

-- UPDATE: company admin and platform admin may rename boards (future use).
-- RLS governs which rows are visible for update. Column-level UPDATE grant
-- (GRANT UPDATE (name) — see Grants section) restricts the authenticated role
-- to only writing boards.name; any attempt to UPDATE team_id or company_id
-- from an anon-key session is rejected at the grant layer before RLS evaluates.
-- Service-role (used by migrations and Server Actions for structural mutations)
-- bypasses column-level grants and retains full write access.
CREATE POLICY boards_update_company_admin
  ON public.boards
  FOR UPDATE
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  )
  WITH CHECK (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

CREATE POLICY boards_update_platform_admin
  ON public.boards
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- No INSERT policy for authenticated role — boards are ONLY created via the
-- create_team_with_board SECURITY DEFINER RPC. Blocking direct INSERT from
-- any authenticated session is the database enforcement of the one-board-per-team
-- invariant and the atomicity requirement.

-- No DELETE policy for authenticated role — board deletion happens exclusively
-- via the ON DELETE CASCADE triggered by team deletion (which in practice goes
-- through a service-role Server Action per ADR-0015).

-- =============================================================================
-- 10. Row Level Security — columns
--
-- Column access is derived from board access, which is derived from team
-- membership. The policy must join through boards to reach team_id.
--
-- Denormalized company_id on columns allows the company-admin bypass to be
-- checked without an extra join to boards (performance optimization for the
-- most common read path — company admin listing all columns).
--
-- SELECT: three-tier.
-- INSERT: no authenticated policy — columns are seeded by create_team_with_board.
-- UPDATE: company admin + platform admin (for future column rename feature).
--         Column-level UPDATE grant restricts what can be changed: only
--         columns.title and columns.position are writable from authenticated
--         sessions (H-1 fix). Structural columns (board_id, company_id) cannot
--         be mutated from the anon-key path.
-- DELETE: cascades from board deletion; no direct authenticated DELETE needed.
-- =============================================================================
ALTER TABLE public.columns ENABLE ROW LEVEL SECURITY;

-- SELECT: platform admin sees all columns
CREATE POLICY columns_select_platform_admin
  ON public.columns
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- SELECT: company admin sees all columns in their company (via denormalized company_id)
CREATE POLICY columns_select_company_admin
  ON public.columns
  FOR SELECT
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

-- SELECT: employee sees columns for boards of teams they belong to.
-- Must join through boards to reach team_id for the team_members check.
-- idx_columns_board_id and idx_team_members_profile_id_team_id cover this.
CREATE POLICY columns_select_member
  ON public.columns
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.boards b
      JOIN   public.team_members tm
             ON  tm.team_id    = b.team_id
             AND tm.profile_id = auth.uid()
      WHERE  b.id = board_id   -- columns.board_id (current row)
    )
  );

-- UPDATE: company admin can update columns in their company (future: rename column).
-- Column-level UPDATE grant restricts writes to title and position only (H-1 fix).
-- board_id and company_id cannot be mutated from any authenticated session.
CREATE POLICY columns_update_company_admin
  ON public.columns
  FOR UPDATE
  TO authenticated
  USING (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  )
  WITH CHECK (
    company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
  );

CREATE POLICY columns_update_platform_admin
  ON public.columns
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
  );

-- No INSERT policy: columns are created only by create_team_with_board RPC.
-- No DELETE policy: columns are deleted via board cascade or service-role.

-- =============================================================================
-- 11. Grants (H-1 fix: column-level UPDATE grants on boards and columns)
--
-- Follow the same grant pattern established in 20260802000001_auth_schema.sql.
-- The anon role gets nothing (no grants).
-- The authenticated role gets SELECT + INSERT on business tables for operations
-- that go through RLS. Column-level UPDATE grants restrict what can be changed.
--
-- boards and columns: authenticated role cannot INSERT (no INSERT policy either)
-- and cannot DELETE (no DELETE policy). The GRANT allows the attempt, but the
-- absent RLS policy blocks it for every authenticated user. We still restrict
-- the grant to the minimum needed operations.
--
-- teams: authenticated role can SELECT, INSERT (create team), UPDATE (rename),
--        DELETE (delete team) — all gated by RLS policies above.
-- team_members: authenticated role can SELECT, INSERT (add member), DELETE
--              (remove member) — gated by RLS. No UPDATE (no policy).
--
-- boards: authenticated role can SELECT only. UPDATE is restricted to the
--         boards.name column via a column-level GRANT. This follows the
--         profiles precedent (GRANT UPDATE (display_name)) — structural columns
--         (team_id, company_id) cannot be mutated from any anon-key session
--         regardless of RLS policy wording. Service-role bypasses column-level
--         grants and retains full write access (H-1 fix).
--
-- columns: authenticated role can SELECT only. UPDATE is restricted to
--          columns.title and columns.position. Structural columns (board_id,
--          company_id) are physically non-writable from the authenticated role
--          (H-1 fix).
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams        TO authenticated;
GRANT SELECT, INSERT,         DELETE ON public.team_members  TO authenticated;

-- boards: SELECT grant + column-level UPDATE on name only (H-1 fix).
-- No table-level UPDATE grant — that would allow board.team_id and board.company_id
-- to be overwritten by any authenticated session passing an RLS check.
GRANT SELECT ON public.boards TO authenticated;
GRANT UPDATE (name) ON public.boards TO authenticated;

-- columns: SELECT grant + column-level UPDATE on title and position only (H-1 fix).
-- board_id and company_id are non-writable from the authenticated role.
GRANT SELECT ON public.columns TO authenticated;
GRANT UPDATE (title, position) ON public.columns TO authenticated;

-- anon gets nothing (no grants — denied before RLS evaluates).

-- =============================================================================
-- 12. Atomic team creation RPC: create_team_with_board (C-1 fix)
--
-- Purpose:
--   Guarantees that a team, its board, and the three seeded columns are created
--   as a single atomic database operation. The PRD (FR-01) states: "Steps 1–3
--   happen as a single atomic operation. The team must not be visible without
--   its board and columns."
--
--   This function provides the database-layer atomicity guarantee. The Server
--   Action calls this function via supabase.rpc('create_team_with_board', {...}).
--
-- Why SECURITY DEFINER:
--   The boards and columns tables have NO authenticated INSERT policy (section
--   11 / 12 above). This is deliberate — boards should only be created as part
--   of team creation, never as a standalone operation. But the function must
--   insert into boards and columns. Running as SECURITY DEFINER (postgres role)
--   bypasses RLS for those inserts while still enforcing the company_id
--   authorization check explicitly in the function body.
--
-- C-1 fix — p_caller_id parameter removed:
--   The original function accepted p_caller_id uuid and used it to look up the
--   caller's role/company from public.profiles. This created a privilege
--   escalation vector: because the function is SECURITY DEFINER, any
--   authenticated user could pass an admin's UUID (discoverable via the
--   team_members SELECT policy) and bypass the authorization check.
--
--   Fix: p_caller_id has been removed from the signature entirely. The function
--   now calls auth.uid() directly inside the function body to obtain the caller's
--   identity. auth.uid() reads the JWT of the current session and cannot be
--   spoofed by the caller regardless of what parameters they pass. This is the
--   correct pattern for SECURITY DEFINER functions that need to authorize the
--   caller: always derive identity from auth.uid(), never from a caller-supplied
--   parameter.
--
--   The old 3-argument overload public.create_team_with_board(uuid, text, uuid)
--   no longer exists in this migration (the migration has not been deployed).
--   If it had been deployed previously, a DROP FUNCTION IF EXISTS on the old
--   signature would be required before the CREATE OR REPLACE (included in the
--   rollback notes and as a safety guard below).
--
-- Authorization is enforced inside the function:
--   - auth.uid() is the sole source of caller identity.
--   - The caller's profile is looked up from public.profiles using auth.uid().
--   - Caller must be is_platform_admin = true OR (role = 'admin' AND company_id = p_company_id).
--   - If unauthorized: raises insufficient_privilege exception (rolls back).
--
-- Caller: Server Action using the authenticated client or the service-role client.
--   supabase.rpc('create_team_with_board', { p_company_id, p_name })
--   Note: p_caller_id is NOT passed — the function derives identity from auth.uid().
--
-- Parameters:
--   p_company_id  uuid  — the company to create the team in
--   p_name        text  — the team name (trimmed, validated inside)
--
-- Returns:
--   jsonb {
--     "team_id":  "<uuid>",
--     "board_id": "<uuid>"
--   }
--   On success the caller has the team_id and board_id for immediate use.
--   On failure an exception is raised (rolls back the full transaction).
--
-- Grant:
--   EXECUTE granted to authenticated (so the Server Action can call it via
--   supabase.rpc() with the anon-key session) AND to service_role.
--   The authorization checks inside the function gate misuse.
--   REVOKE from PUBLIC for defense-in-depth.
-- =============================================================================

-- Safety guard: drop the old 3-argument overload if it somehow exists
-- (e.g. from a partial deploy of an earlier draft of this migration).
-- The migration has not been deployed to any environment, but this guard
-- ensures the new 2-argument version is the only callable overload.
DROP FUNCTION IF EXISTS public.create_team_with_board(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.create_team_with_board(
  p_company_id  uuid,
  p_name        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- prevent search_path injection; all refs are schema-qualified
AS $$
DECLARE
  v_caller_id          uuid;
  v_caller_role        text;
  v_caller_platform    boolean;
  v_caller_company_id  uuid;
  v_trimmed_name       text;
  v_team_id            uuid;
  v_board_id           uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- Derive caller identity from auth.uid() — the only safe source of caller
  -- identity in a SECURITY DEFINER function. Never use a caller-supplied
  -- parameter (C-1 fix: p_caller_id was removed for this reason).
  -- auth.uid() reads the session JWT and cannot be spoofed by the caller.
  -- -------------------------------------------------------------------------
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'create_team_with_board: no authenticated session (auth.uid() is NULL)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- -------------------------------------------------------------------------
  -- Authorization check
  -- Retrieve caller's profile using auth.uid() (not any caller-supplied param).
  -- Running SECURITY DEFINER means we bypass RLS here, so we must perform
  -- the authorization check ourselves — we cannot rely on RLS to filter the
  -- profile lookup.
  -- -------------------------------------------------------------------------
  SELECT role, is_platform_admin, company_id
  INTO   v_caller_role, v_caller_platform, v_caller_company_id
  FROM   public.profiles
  WHERE  id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_team_with_board: caller profile not found (auth.uid()=%)', v_caller_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Platform admins may create teams in any company.
  -- Company admins may only create teams in their own company.
  IF NOT (
    v_caller_platform = true
    OR (v_caller_role = 'admin' AND v_caller_company_id = p_company_id)
  ) THEN
    RAISE EXCEPTION 'create_team_with_board: insufficient privileges — caller % cannot create a team in company %',
      v_caller_id, p_company_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- -------------------------------------------------------------------------
  -- Name validation (L-1 fix: explicit NULL check before trim)
  -- Mirrors table-level CHECK constraints for early, informative feedback.
  -- NULL must be caught first: trim(NULL) = NULL, char_length(NULL) = NULL,
  -- so the empty/length guards below evaluate to NULL (not true) and silently
  -- pass, leading to a raw NOT NULL column violation. We raise a clear
  -- check_violation instead.
  -- -------------------------------------------------------------------------
  IF p_name IS NULL THEN
    RAISE EXCEPTION 'Team name cannot be null'
      USING ERRCODE = 'check_violation';
  END IF;

  v_trimmed_name := trim(p_name);

  IF char_length(v_trimmed_name) = 0 THEN
    RAISE EXCEPTION 'Team name cannot be empty after trimming whitespace'
      USING ERRCODE = 'check_violation';
  END IF;

  IF char_length(v_trimmed_name) > 100 THEN
    RAISE EXCEPTION 'Team name exceeds maximum length of 100 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- -------------------------------------------------------------------------
  -- Insert team (the unique index on (company_id, lower(trim(name))) will
  -- raise a unique_violation if a duplicate name exists — this is the
  -- concurrency-safe uniqueness check, superior to SELECT-before-INSERT).
  -- -------------------------------------------------------------------------
  INSERT INTO public.teams (company_id, name)
  VALUES (p_company_id, v_trimmed_name)
  RETURNING id INTO v_team_id;

  -- -------------------------------------------------------------------------
  -- Insert board (one-board-per-team guaranteed by the UNIQUE(team_id) constraint
  -- on boards, but since this is the only INSERT path for boards, it is
  -- simply sequential here).
  -- The check_board_company_id_match trigger will fire here and assert that
  -- company_id = teams.company_id. Since we derive both from the same source
  -- (p_company_id), the trigger will always pass for this RPC.
  -- -------------------------------------------------------------------------
  INSERT INTO public.boards (team_id, company_id, name)
  VALUES (v_team_id, p_company_id, v_trimmed_name || ' Board')
  RETURNING id INTO v_board_id;

  -- -------------------------------------------------------------------------
  -- Seed three columns in fixed order per PRD FR-01.
  -- Positions 1=Todo, 2=In Progress, 3=Done are invariants at creation time.
  -- The check_column_company_id_match trigger fires for each row and asserts
  -- company_id = boards.company_id. Passes because we use the same p_company_id.
  -- -------------------------------------------------------------------------
  INSERT INTO public.columns (board_id, company_id, title, position)
  VALUES
    (v_board_id, p_company_id, 'Todo',        1),
    (v_board_id, p_company_id, 'In Progress', 2),
    (v_board_id, p_company_id, 'Done',        3);

  -- -------------------------------------------------------------------------
  -- Return the created team_id and board_id for the caller to use immediately.
  -- -------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'team_id',  v_team_id,
    'board_id', v_board_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_team_with_board(uuid, text) IS
  'Atomic team creation RPC. Creates a team, its board, and the three seeded columns (Todo, In Progress, Done) in a single transaction. Caller identity is derived from auth.uid() — not from any caller-supplied parameter (C-1 security fix: p_caller_id was removed to prevent privilege escalation). Enforces caller authorization (company admin within own company, or platform admin) using the auth.uid()-derived profile. SECURITY DEFINER is required to INSERT into boards and columns (which have no authenticated INSERT policy). Called via supabase.rpc(''create_team_with_board'', { p_company_id, p_name }) from the createTeamAction Server Action. Returns { team_id, board_id } on success; raises exception on failure (rolls back everything). ADR-0015, PRD FR-01.';

-- Grant EXECUTE to authenticated so the Server Action can call via supabase.rpc()
-- with either the anon-key session or the service-role client.
-- The authorization checks INSIDE the function (using auth.uid()) prevent misuse.
GRANT EXECUTE ON FUNCTION public.create_team_with_board(uuid, text)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_team_with_board(uuid, text)
  TO service_role;

-- Revoke from PUBLIC (defense-in-depth — consistent with existing pattern).
REVOKE EXECUTE ON FUNCTION public.create_team_with_board(uuid, text)
  FROM PUBLIC;

-- =============================================================================
-- End of migration 20260809000001_teams_schema.sql
-- =============================================================================
