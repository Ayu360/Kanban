-- =============================================================================
-- Migration: 20260820000003_tasks_schema.sql
-- Purpose:   Tasks module database layer — Phase 1 (PRD 04).
--            Introduces the `public.tasks` table with all columns, CHECK
--            constraints, indexes, the updated_at trigger, the company_id
--            consistency trigger, and RLS policies.
--
-- Dependencies (must be applied in this exact order before this migration):
--   20260802000001_auth_schema.sql            — public.profiles, public.companies,
--                                               public.handle_updated_at()
--   20260809000001_teams_schema.sql           — public.boards, public.columns
--   20260816000001_fix_team_members_rls_recursion.sql
--                                             — public.is_team_member(uuid) helper
--   20260816000002_employees_schema.sql       — profiles.status
--   20260818000001_grant_service_role_table_privileges.sql
--                                             — ALTER DEFAULT PRIVILEGES (service_role)
--   20260819000001_team_members_surrogate_pk.sql — team_members surrogate PK
--   20260819000002_employee_lifecycle_deletion.sql — lifecycle RPCs
--   20260820000001_admin_employee_list_add_deletion_scheduled.sql
--   20260820000002_create_team_with_board_creator.sql
--
-- Domain context:
--   tasks are owned by columns (ON DELETE CASCADE), which are owned by boards
--   (ON DELETE CASCADE). Deleting a column removes all its tasks; deleting a
--   board removes all columns and their tasks.
--
-- Tombstone-first FK behavior (PRD 05 contract):
--   tasks.assignee_id  → profiles.id ON DELETE SET NULL
--   tasks.created_by   → profiles.id ON DELETE SET NULL
--   When an employee is hard-deleted (PRD 05), any tasks they were assigned to
--   or created will persist with the relevant column set to NULL rather than
--   being cascade-deleted. Application code treats created_by as write-once at
--   insert time; the NULL transition is only ever triggered by the FK SET NULL
--   action on profile deletion. This mirrors the pattern established for
--   team_members.profile_id and boards.created_by.
--
-- Position calculation contract:
--   task.position is an INTEGER managed client-side. On creation and on move,
--   the backend agent's tasksService.create() / tasksService.move() computes
--     SELECT MAX(position) FROM tasks WHERE column_id = $1
--   and adds 1 before the INSERT/UPDATE. No RPC is provided for position
--   management in Phase 1 (by design — deferred per locked decision). A race
--   between two concurrent inserts produces a temporary position tie that
--   resolves on the next onSettled invalidation (cosmetic, accepted behavior).
--
-- Service-role grants:
--   ALTER DEFAULT PRIVILEGES set in 20260818000001 means any table created in
--   public by the postgres role automatically receives GRANT ALL to service_role.
--   This covers public.tasks without any explicit GRANT here. Smoke test below.
--
-- Rollback considerations (dev/staging ONLY — NEVER on production with live data):
--   DROP TRIGGER  IF EXISTS tasks_company_id_match_check ON public.tasks;
--   DROP FUNCTION IF EXISTS public.check_task_company_id_match() CASCADE;
--   DROP TRIGGER  IF EXISTS tasks_updated_at ON public.tasks;
--   DROP TABLE    IF EXISTS public.tasks CASCADE;
-- =============================================================================


-- =============================================================================
-- 1. public.tasks table
--
-- Design decisions:
--
--   column_id / board_id:
--     Both carry ON DELETE CASCADE from their parent tables. board_id is
--     denormalized on tasks (rather than deriving it via column_id → board_id)
--     for two reasons:
--       a) RLS performance: the Tier-3 team-membership policy needs board_id to
--          join team_members without a double-hop through columns then boards.
--       b) Client convenience: getBoardWithDetails() returns tasks grouped by
--          board directly without a join.
--     Consistency between column_id.board_id and the denormalized board_id is
--     enforced by the check_task_company_id_match trigger (see Section 3).
--
--   company_id:
--     Denormalized onto tasks per ADR-0006 (every business table carries
--     company_id NOT NULL). This eliminates a join to boards on every RLS
--     evaluation for the company-admin bypass path. ON DELETE RESTRICT on
--     companies: a company cannot be dropped while tasks reference it.
--     Consistency with the parent column's company_id is enforced by
--     check_task_company_id_match trigger (Section 3).
--
--   title:
--     CHECK enforces non-empty after trim AND max 500 characters (PRD validation).
--     NOT NULL enforces presence. The application layer also validates, but the
--     database constraint is the authoritative enforcement layer.
--
--   description:
--     NULL allowed (optional). If provided, max 5000 characters per PRD.
--
--   priority:
--     CHECK constraint on three fixed values. TEXT (not an enum type) per project
--     convention — adding a new priority value later is a simple ALTER TABLE with
--     a new CHECK; adding to an enum type requires ALTER TYPE which is lock-heavy.
--
--   assignee_id / created_by:
--     Both nullable. ON DELETE SET NULL — tombstone-first per PRD 05 contract.
--     created_by is write-once in application code (TasksService.create writes it
--     from auth.uid(); subsequent UPDATE calls never touch this field). The NULL
--     transition is only ever triggered by the FK ON DELETE SET NULL action.
--
--   position:
--     INTEGER NOT NULL. Client-side MAX(position)+1 calculation on insert/move
--     (Phase 1 locked decision). No unique constraint — temporary ties are
--     acceptable and resolve on invalidation.
--
--   created_at / updated_at:
--     Standard timestamptz NOT NULL defaults. updated_at is auto-maintained by
--     the handle_updated_at() trigger (defined in 20260802000001).
--
-- Multi-tenancy readiness:
--   company_id is present and non-nullable from day one per ADR-0006.
--   The RLS company-admin bypass path is company_id-gated. Tenant isolation
--   constraints can be layered in without breaking changes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  column_id    uuid        NOT NULL,
  board_id     uuid        NOT NULL,
  company_id   uuid        NOT NULL,
  title        text        NOT NULL,
  description  text        NULL,
  priority     text        NOT NULL DEFAULT 'medium',
  assignee_id  uuid        NULL,
  due_date     date        NULL,
  position     integer     NOT NULL,
  created_by   uuid        NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tasks_pkey
    PRIMARY KEY (id),

  -- column_id: ON DELETE CASCADE — deleting the column deletes all its tasks.
  CONSTRAINT tasks_column_id_fkey
    FOREIGN KEY (column_id)
    REFERENCES public.columns (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  -- board_id: ON DELETE CASCADE — deleting the board deletes all its tasks.
  -- Denormalized for RLS performance (avoids join columns→boards in Tier-3 policy).
  -- Consistency with column_id's board enforced by check_task_company_id_match trigger.
  CONSTRAINT tasks_board_id_fkey
    FOREIGN KEY (board_id)
    REFERENCES public.boards (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  -- company_id: ON DELETE RESTRICT — a company cannot be dropped while tasks exist.
  -- Denormalized for RLS performance (company-admin bypass avoids upstream join).
  -- Consistency with column's company_id enforced by check_task_company_id_match trigger.
  CONSTRAINT tasks_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  -- assignee_id: ON DELETE SET NULL — tombstone-first (PRD 05 contract).
  -- Hard-deleting a profile leaves tasks assigned to them intact with assignee_id = NULL.
  CONSTRAINT tasks_assignee_id_fkey
    FOREIGN KEY (assignee_id)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  -- created_by: ON DELETE SET NULL — tombstone-first (PRD 05 contract).
  -- Hard-deleting a profile leaves their created tasks intact with created_by = NULL.
  -- Application code treats this as write-once (set at INSERT from auth.uid()).
  CONSTRAINT tasks_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,

  -- title: non-empty after trim, max 500 characters (PRD validation rule).
  CONSTRAINT tasks_title_check
    CHECK (char_length(trim(title)) BETWEEN 1 AND 500),

  -- description: max 5000 characters if provided (PRD validation rule).
  CONSTRAINT tasks_description_check
    CHECK (description IS NULL OR char_length(description) <= 5000),

  -- priority: exactly three allowed values.
  -- TEXT CHECK (not an enum type) per project convention — ALTER TYPE is
  -- lock-heavy; a new CHECK is a simple ALTER TABLE migration.
  CONSTRAINT tasks_priority_check
    CHECK (priority IN ('low', 'medium', 'high'))
);

-- Table and column comments
COMMENT ON TABLE public.tasks IS
  'Kanban task cards. Each task belongs to a column within a board. '
  'Phase 1: PRD 04. Tombstone-first: assignee_id and created_by are ON DELETE '
  'SET NULL so tasks persist after employee deletion (PRD 05 FR-17 contract). '
  'Position: INTEGER managed client-side (MAX+1); no RPC in Phase 1. '
  'ADR-0006 (company_id), ADR-0009 (RLS three-tier).';

COMMENT ON COLUMN public.tasks.id IS
  'Surrogate UUID primary key per project convention.';

COMMENT ON COLUMN public.tasks.column_id IS
  'FK to columns. ON DELETE CASCADE — deleting the column deletes all its tasks.';

COMMENT ON COLUMN public.tasks.board_id IS
  'FK to boards. ON DELETE CASCADE. Denormalized from column_id for RLS performance '
  '(avoids joining through columns in the Tier-3 policy). Consistency enforced by '
  'check_task_company_id_match trigger.';

COMMENT ON COLUMN public.tasks.company_id IS
  'Tenant scope per ADR-0006. Non-nullable. Denormalized for RLS company-admin '
  'bypass performance (avoids joining through columns→boards). Consistency with '
  'parent column enforced by check_task_company_id_match trigger.';

COMMENT ON COLUMN public.tasks.title IS
  'Task title. Non-empty after trim, max 500 characters. Enforced by CHECK constraint.';

COMMENT ON COLUMN public.tasks.description IS
  'Optional task description. Max 5000 characters. NULL means not set.';

COMMENT ON COLUMN public.tasks.priority IS
  'Task urgency indicator. One of: low, medium, high. Default: medium. '
  'Enforced by CHECK constraint. TEXT (not enum) per project convention.';

COMMENT ON COLUMN public.tasks.assignee_id IS
  'Profile ID of the assigned employee. NULL means unassigned. '
  'ON DELETE SET NULL — tombstone-first: hard-deleting an employee leaves '
  'tasks assigned to them intact with assignee_id = NULL (PRD 05 FR-17). '
  'Frontend renders NULL as no-assignee (same UX as never-assigned in MVP).';

COMMENT ON COLUMN public.tasks.due_date IS
  'Optional due date. DATE (not timestamp) — date-only per PRD FR-08. '
  'No constraint that due date must be in the future.';

COMMENT ON COLUMN public.tasks.position IS
  'Display order within the column. INTEGER. Managed client-side: backend '
  'computes MAX(position) + 1 before each INSERT/UPDATE. Temporary ties from '
  'concurrent inserts are cosmetic and resolve on next onSettled invalidation.';

COMMENT ON COLUMN public.tasks.created_by IS
  'Profile ID of the user who created this task. NULL if the creator has been '
  'hard-deleted (ON DELETE SET NULL — PRD 05 FR-17 tombstone contract). '
  'Write-once in application code: set from auth.uid() at INSERT time; UPDATE '
  'calls must not touch this column. Frontend renders NULL as [Deleted User] '
  'if creator attribution is ever surfaced (not prominent in MVP).';

COMMENT ON COLUMN public.tasks.created_at IS
  'Row creation timestamp (UTC). Set once at INSERT. Never updated.';

COMMENT ON COLUMN public.tasks.updated_at IS
  'Last modification timestamp (UTC). Auto-maintained by tasks_updated_at trigger '
  'using public.handle_updated_at(). Set on every UPDATE.';


-- =============================================================================
-- 2. updated_at trigger
--
-- Reuses the shared public.handle_updated_at() function defined in
-- 20260802000001_auth_schema.sql. That function is a CREATE OR REPLACE and will
-- always exist before this migration runs (it is a hard dependency). We attach
-- it to tasks with a BEFORE UPDATE trigger — matching the pattern on teams,
-- boards, and columns.
-- =============================================================================

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TRIGGER tasks_updated_at ON public.tasks IS
  'Automatically sets updated_at = now() on every UPDATE via handle_updated_at(). '
  'Defined in 20260802000001_auth_schema.sql and reused here (no new function needed).';


-- =============================================================================
-- 3. Consistency trigger: check_task_company_id_match
--
-- Purpose:
--   Assert that tasks.company_id always equals the company_id of the parent
--   column (which in turn equals boards.company_id). This column is denormalized
--   onto tasks for RLS performance. If it drifts, tenant isolation breaks silently.
--
--   Also verify that tasks.board_id equals the board_id of the parent column.
--   This catches cases where a client or migration inserts a task with mismatched
--   board_id and column_id (e.g. a column from one board and a board_id from
--   another). Both invariants are checked in the same trigger.
--
-- Mirrors exactly: check_board_company_id_match (20260809000001) and
--                  check_column_company_id_match (20260809000001).
--
-- Why SECURITY DEFINER:
--   The trigger reads public.columns.company_id and public.columns.board_id. If
--   this trigger ran as INVOKER, it could be affected by RLS on columns in future
--   configurations. Using SECURITY DEFINER makes the enforcement unconditional and
--   consistent regardless of the calling session's role — the same safe pattern
--   used for the board and column consistency triggers.
--
-- Performance optimization on UPDATE:
--   Skip the check entirely when neither column_id nor company_id has changed.
--   This avoids an unnecessary SELECT on columns for every title/description/
--   priority/assignee/due_date UPDATE — the common case.
--
-- Error codes (matching the existing pattern):
--   foreign_key_violation (23503): parent column not found.
--   check_violation (23514): company_id or board_id mismatch.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_task_company_id_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_column_company_id uuid;
  v_column_board_id   uuid;
BEGIN
  -- Performance optimization: on UPDATE, skip the check when neither column_id
  -- nor company_id has changed. The common UPDATE path (editing title, description,
  -- priority, assignee, due_date) touches none of these structural columns.
  IF TG_OP = 'UPDATE'
     AND NEW.column_id  = OLD.column_id
     AND NEW.company_id = OLD.company_id
     AND NEW.board_id   = OLD.board_id
  THEN
    RETURN NEW;
  END IF;

  -- Look up the company_id and board_id of the parent column.
  -- SECURITY DEFINER ensures RLS on columns does not filter this lookup.
  SELECT company_id, board_id
  INTO   v_column_company_id, v_column_board_id
  FROM   public.columns
  WHERE  id = NEW.column_id;

  -- Belt-and-suspenders: the FK constraint on tasks.column_id will also catch a
  -- missing column, but we raise an explicit error here for a more informative
  -- message (same pattern as check_board_company_id_match).
  IF v_column_company_id IS NULL THEN
    RAISE EXCEPTION
      'tasks company_id consistency guard: column not found (column_id=%)',
      NEW.column_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Assert company_id consistency.
  IF NEW.company_id <> v_column_company_id THEN
    RAISE EXCEPTION
      'tasks.company_id (%) must equal columns.company_id (%) for column_id=%',
      NEW.company_id, v_column_company_id, NEW.column_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Assert board_id consistency: the board_id on the task must match the
  -- board_id of the parent column. This catches mismatched cross-board inserts.
  IF NEW.board_id <> v_column_board_id THEN
    RAISE EXCEPTION
      'tasks.board_id (%) must equal columns.board_id (%) for column_id=%',
      NEW.board_id, v_column_board_id, NEW.column_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_task_company_id_match() IS
  'BEFORE INSERT OR UPDATE trigger on tasks. Asserts tasks.company_id equals '
  'columns.company_id and tasks.board_id equals columns.board_id for the task''s '
  'parent column. Prevents tenant isolation drift when the denormalized company_id '
  'is written incorrectly, and prevents cross-board column/board_id mismatches. '
  'SECURITY DEFINER for unconditional enforcement regardless of calling session. '
  'UPDATE optimization: skips the check when column_id, company_id, and board_id '
  'are all unchanged (common case for title/description/priority edits). '
  'Mirrors check_board_company_id_match and check_column_company_id_match. ADR-0006.';

CREATE TRIGGER tasks_company_id_match_check
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.check_task_company_id_match();


-- =============================================================================
-- 4. Indexes
--
-- Justification for each index follows the query pattern analysis pattern
-- established in 20260809000001 and 20260819000002.
-- =============================================================================

-- I1. idx_tasks_board_id — board-scoped task listing (primary read path).
--     Query: SELECT * FROM tasks WHERE board_id = $1 ORDER BY position
--     Used by: TasksRepository.getBoardWithDetails(), the board page load.
--     This is the highest-frequency query on the tasks table.
CREATE INDEX IF NOT EXISTS idx_tasks_board_id
  ON public.tasks (board_id);

COMMENT ON INDEX public.idx_tasks_board_id IS
  'Supports listing all tasks for a board: WHERE board_id = $1. '
  'Primary read path for getBoardWithDetails() and the board page load. '
  'Highest-frequency query on tasks.';

-- I2. idx_tasks_column_id — column-scoped filtering within a board.
--     Query: SELECT * FROM tasks WHERE column_id = $1 ORDER BY position
--     Used by: position calculation (SELECT MAX(position) WHERE column_id = $1)
--     and column-level invalidation after task create/move.
CREATE INDEX IF NOT EXISTS idx_tasks_column_id
  ON public.tasks (column_id);

COMMENT ON INDEX public.idx_tasks_column_id IS
  'Supports column-scoped queries: WHERE column_id = $1. '
  'Used for position calculation (MAX(position) lookup) and column-level '
  'cache invalidation after task create/move.';

-- I3. idx_tasks_assignee_id — assignee-based queries (partial: non-null only).
--     Query: SELECT * FROM tasks WHERE assignee_id = $1
--     Used by: future "my tasks" cross-team views (post-MVP); also useful for
--     cleanup queries when an employee is deactivated (find all their tasks).
--     Partial index: NULL assignee_id rows (unassigned tasks) are excluded.
--     Expected: majority of tasks may be unassigned; partial keeps the index small.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id
  ON public.tasks (assignee_id)
  WHERE assignee_id IS NOT NULL;

COMMENT ON INDEX public.idx_tasks_assignee_id IS
  'Supports assignee-based task lookup: WHERE assignee_id = $1. '
  'Partial index (WHERE assignee_id IS NOT NULL): excludes unassigned tasks '
  'which are the common case in many workflows, keeping the index small. '
  'Used for future cross-team "my tasks" views and employee deletion cleanup.';

-- I4. idx_tasks_company_id — company-admin bypass path (Reviewer Y2 requirement).
--     Query pattern in RLS Tier-2: WHERE tasks.company_id = jwt.company_id AND role = admin
--     Without this index, every board query by a company admin would scan the
--     entire tasks table to evaluate the Tier-2 policy. This mirrors the pattern
--     on boards (idx_boards_company_id) and columns (idx_columns_company_id).
CREATE INDEX IF NOT EXISTS idx_tasks_company_id
  ON public.tasks (company_id);

COMMENT ON INDEX public.idx_tasks_company_id IS
  'Supports tasks RLS Tier-2 company-admin bypass: WHERE company_id = jwt.company_id. '
  'Required per Reviewer Y2: without this index, company-admin board queries scan '
  'the entire tasks table. Mirrors idx_boards_company_id and idx_columns_company_id. '
  'Leading-column prefix also covers any query filtering on company_id alone.';

-- Note on existing indexes that cover tasks RLS:
--   idx_team_members_profile_id_team_id (20260809000001) covers the Tier-3
--   EXISTS subquery: WHERE profile_id = auth.uid() AND team_id = ...
--   boards_team_id_unique (20260809000001) is a unique index on boards(team_id)
--   and also covers the boards.team_id lookup in the Tier-3 join.
--   No additional indexes needed for those join columns.


-- =============================================================================
-- 5. Row Level Security
--
-- Pattern: three-tier per ADR-0009 (established on boards and columns).
--
--   Tier 1 (platform admin bypass):
--     (auth.jwt()->'app_metadata'->>'is_platform_admin')::boolean = true
--
--   Tier 2 (company admin bypass):
--     tasks.company_id = (auth.jwt()->'app_metadata'->>'company_id')::uuid
--     AND (auth.jwt()->'app_metadata'->>'role')::text = 'admin'
--
--   Tier 3 (team membership filter):
--     EXISTS (
--       SELECT 1
--       FROM   public.team_members tm
--       JOIN   public.boards b ON b.team_id = tm.team_id
--       WHERE  tm.profile_id = auth.uid()
--         AND  b.id = tasks.board_id
--     )
--
-- Recursion audit (Reviewer Y2 requirement):
--   The Tier-3 EXISTS joins team_members and boards. team_members has its own
--   RLS (team_members_select_member policy). In 20260816000001, that policy was
--   fixed to call public.is_team_member(uuid) SECURITY DEFINER to break the
--   recursion loop. However, the Tier-3 query here is NOT a policy on team_members
--   itself — it is a subquery inside a policy on tasks. When PostgreSQL evaluates
--   this subquery, it DOES apply RLS on team_members (because the calling session
--   is authenticated, not a SECURITY DEFINER context).
--
--   This means the team_members_select_member policy fires, which calls
--   public.is_team_member(team_id). That helper bypasses RLS on team_members
--   itself, so no further recursion occurs. The chain is:
--     tasks policy → EXISTS on team_members → team_members_select_member fires
--       → is_team_member() SECURITY DEFINER → direct scan on team_members (no RLS)
--       → returns boolean → no recursion.
--
--   To eliminate this indirect chain entirely and guarantee no recursion under
--   any future RLS change to team_members, the Tier-3 EXISTS uses
--   public.is_team_member() directly. This bypasses RLS on team_members
--   in our subquery without needing a SECURITY DEFINER tasks policy, while
--   also matching the post-fix pattern established in 20260816000001 for
--   teams_select_member and team_members_select_member.
--
--   The Tier-3 join shape used here:
--     public.is_team_member(b.team_id)
--     WHERE b.id = tasks.board_id
--   reads boards (subject to RLS) to get team_id, then calls is_team_member().
--   boards has SELECT policies for team members, so the boards read is safe.
--   The boards_select_member policy itself uses is_team_member() — same safe
--   pattern, no recursion.
--
--   For maximum safety and to avoid the indirect chain, the Tier-3 query uses
--   a direct EXISTS that calls is_team_member() with the board's team_id,
--   fetched from public.boards via a non-RLS-gated subquery:
--
--     EXISTS (
--       SELECT 1
--       FROM   public.boards b
--       WHERE  b.id = tasks.board_id
--         AND  public.is_team_member(b.team_id)
--     )
--
--   public.boards is RLS-protected, but the boards_select_member policy calls
--   is_team_member() — which is STABLE + SECURITY DEFINER. The planner can
--   reuse the cached result across the tasks scan. No recursion path exists.
--
-- SAFETY INVARIANT (do not violate):
--   The Tier-3 chain here transits public.boards RLS via boards_select_member.
--   That policy MUST continue to call is_team_member() (SECURITY DEFINER) rather
--   than reintroducing a raw `SELECT ... FROM public.team_members` EXISTS.
--   A future rewrite of boards_select_member that regresses to raw team_members
--   reads would silently create a recursion loop through this tasks policy
--   (tasks → boards → team_members → back into RLS on any table referencing
--   team_members). Preserve is_team_member() in boards_select_member to keep
--   this chain safe. If boards RLS ever changes, re-audit this policy.
--
-- WITH CHECK requirement (Reviewer Y2 mandatory):
--   INSERT policies: WITH CHECK only (no USING on INSERT).
--   UPDATE policies: USING + WITH CHECK (mirror both clauses).
--   The WITH CHECK on writes ensures a malicious client cannot INSERT a task
--   with a mismatched company_id that bypasses the consistency trigger.
--   Specifically: WITH CHECK (company_id = jwt.company_id) on Tier-2 means
--   a company admin cannot write tasks for another company's board even if they
--   somehow obtain the column_id and board_id.
--
-- Access model:
--   SELECT: all three tiers (platform admin, company admin, team member).
--   INSERT: all three tiers (any team member can create a task on a board they
--           can see). WITH CHECK enforces the row being inserted belongs to the
--           calling user's company (Tier-2) or to a board they are a member of (Tier-3).
--   UPDATE: all three tiers. USING filters which rows are visible for update.
--           WITH CHECK ensures the row after update still satisfies the policy.
--   DELETE: all three tiers. Per PRD FR-05, any authenticated team member can
--           delete any task on a board they have access to.
-- =============================================================================

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- SELECT policy
-- ---------------------------------------------------------------------------

CREATE POLICY tasks_select
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    -- Tier 1: platform admin sees all tasks everywhere.
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
    OR
    -- Tier 2: company admin sees all tasks in their own company.
    (
      tasks.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
      AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    )
    OR
    -- Tier 3: team members see tasks on boards of teams they belong to.
    -- Uses is_team_member() SECURITY DEFINER helper to avoid RLS recursion
    -- through team_members (established pattern from 20260816000001).
    EXISTS (
      SELECT 1
      FROM   public.boards b
      WHERE  b.id = tasks.board_id
        AND  public.is_team_member(b.team_id)
    )
  );

COMMENT ON POLICY tasks_select ON public.tasks IS
  'Three-tier SELECT per ADR-0009. Tier 1: platform admin. '
  'Tier 2: company admin (own company_id). '
  'Tier 3: team member — EXISTS on boards + is_team_member() SECURITY DEFINER '
  'to avoid RLS recursion through team_members (20260816000001 pattern).';


-- ---------------------------------------------------------------------------
-- INSERT policy
-- ---------------------------------------------------------------------------
-- Note: INSERT policies use WITH CHECK only (no USING clause — USING applies
-- to rows already in the table; WITH CHECK applies to the row being inserted).

CREATE POLICY tasks_insert
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Tier 1: platform admin can insert tasks anywhere.
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
    OR
    -- Tier 2: company admin can insert tasks in their own company only.
    -- WITH CHECK ensures the inserted row's company_id matches the JWT company.
    (
      tasks.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
      AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    )
    OR
    -- Tier 3: team member can insert tasks on boards of their teams only.
    -- WITH CHECK ensures the task is being created on an accessible board.
    EXISTS (
      SELECT 1
      FROM   public.boards b
      WHERE  b.id = tasks.board_id
        AND  public.is_team_member(b.team_id)
    )
  );

COMMENT ON POLICY tasks_insert ON public.tasks IS
  'Three-tier INSERT per ADR-0009. WITH CHECK only (no USING on INSERT). '
  'Reviewer Y2: WITH CHECK prevents malicious client from inserting tasks with '
  'mismatched company_id or on inaccessible boards. '
  'Tier 1: platform admin. Tier 2: company admin + company_id match. '
  'Tier 3: team member — board must be accessible via is_team_member().';


-- ---------------------------------------------------------------------------
-- UPDATE policy
-- ---------------------------------------------------------------------------

CREATE POLICY tasks_update
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    -- USING: which tasks are visible for update (same shape as SELECT).
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
    OR
    (
      tasks.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
      AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    )
    OR
    EXISTS (
      SELECT 1
      FROM   public.boards b
      WHERE  b.id = tasks.board_id
        AND  public.is_team_member(b.team_id)
    )
  )
  WITH CHECK (
    -- WITH CHECK: the row after update must still satisfy the same policy.
    -- Reviewer Y2: prevents a team member from moving a task to an inaccessible
    -- board via UPDATE or changing company_id to another tenant.
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
    OR
    (
      tasks.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
      AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    )
    OR
    EXISTS (
      SELECT 1
      FROM   public.boards b
      WHERE  b.id = tasks.board_id
        AND  public.is_team_member(b.team_id)
    )
  );

COMMENT ON POLICY tasks_update ON public.tasks IS
  'Three-tier UPDATE per ADR-0009. USING + WITH CHECK (mirrored). '
  'Reviewer Y2: WITH CHECK ensures the post-update row still belongs to an '
  'accessible board and the correct company — prevents cross-board moves to '
  'inaccessible boards and company_id tampering. '
  'Tier 1: platform admin. Tier 2: company admin. Tier 3: team member.';


-- ---------------------------------------------------------------------------
-- DELETE policy
-- ---------------------------------------------------------------------------

CREATE POLICY tasks_delete
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    -- USING only (no WITH CHECK on DELETE).
    -- Per PRD FR-05: any authenticated team member can delete any task on a
    -- board they have access to (enforced by Tier-3 team membership filter).
    (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
    OR
    (
      tasks.company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
      AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
    )
    OR
    EXISTS (
      SELECT 1
      FROM   public.boards b
      WHERE  b.id = tasks.board_id
        AND  public.is_team_member(b.team_id)
    )
  );

COMMENT ON POLICY tasks_delete ON public.tasks IS
  'Three-tier DELETE per ADR-0009. USING only. '
  'Per PRD FR-05: any team member with board access can delete any task on '
  'that board (no task-creator-only restriction in MVP). '
  'Tier 1: platform admin. Tier 2: company admin. Tier 3: team member.';


-- =============================================================================
-- 6. Grants
--
-- Follow the established project grant pattern.
-- REVOKE from PUBLIC (defense-in-depth).
-- GRANT SELECT, INSERT, UPDATE, DELETE to authenticated — RLS policies gate
-- actual row access. Without the table-level grant, PostgreSQL rejects the
-- operation before even reaching RLS.
--
-- Service-role:
--   ALTER DEFAULT PRIVILEGES in 20260818000001_grant_service_role_table_privileges.sql
--   automatically grants GRANT ALL to service_role for any table created in
--   public by the postgres role. Since all migrations run as postgres (Supabase
--   convention), this grant is inherited automatically. No explicit GRANT here.
--
--   Smoke test to verify (run after migration):
--     BEGIN;
--     SET LOCAL ROLE service_role;
--     SELECT count(*) FROM public.tasks;  -- must return 0 rows, not 42501
--     ROLLBACK;
--
-- anon role: no grants (denied before RLS evaluates).
-- =============================================================================

REVOKE ALL ON TABLE public.tasks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;


-- =============================================================================
-- End of migration 20260820000003_tasks_schema.sql
-- PRD 04 (Tasks module) — Phase 1 database layer.
-- Tables: public.tasks
-- Triggers: tasks_updated_at (handle_updated_at), tasks_company_id_match_check
-- Indexes: idx_tasks_board_id, idx_tasks_column_id, idx_tasks_assignee_id,
--          idx_tasks_company_id
-- RLS: tasks_select, tasks_insert, tasks_update, tasks_delete
-- =============================================================================
