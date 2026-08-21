-- =============================================================================
-- Migration: 20260820000002_create_team_with_board_creator.sql
-- Purpose:   Updates the create_team_with_board RPC to write boards.created_by
--            so boards are attributable to their creator for tombstone tracking.
--
-- Depends on:
--   20260809000001_teams_schema.sql     — original create_team_with_board RPC
--   20260819000001_team_members_surrogate_pk.sql — boards.created_by column
--
-- What this migration changes:
--   CREATE OR REPLACE FUNCTION create_team_with_board — adds created_by = auth.uid()
--   to the boards INSERT. All other logic, grants, and REVOKE are preserved.
--
-- Gap (b) from senior-code-reviewer: boards.created_by was added in
-- 20260819000001 but the create_team_with_board RPC was not updated to write
-- it. As a result all new boards have created_by = NULL, which breaks
-- tombstone attribution after employee deletion. The boards.created_by FK is
-- ON DELETE SET NULL — after a hard delete the column becomes NULL even for
-- boards that previously had a known creator. Without writing created_by at
-- creation time there is no attribution to set NULL, defeating the tombstone
-- pattern (FR-16).
--
-- Note: auth.uid() is available because this RPC is called with an
-- authenticated session (the Server Action uses either the authenticated client
-- or service-role; the create_team_with_board RPC is GRANT'd to both). The
-- SECURITY DEFINER context preserves the session's auth.uid() value — it runs
-- as the postgres role but the JWT claims (including auth.uid()) from the
-- original caller's session are still accessible inside the function body.
--
-- Rollback (dev/staging only):
--   CREATE OR REPLACE FUNCTION public.create_team_with_board(uuid, text) ...
--   (revert to the version from 20260809000001 without created_by in the boards INSERT)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_team_with_board(
  p_company_id  uuid,
  p_name        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  -- Derive caller identity from auth.uid() — the only safe source of caller
  -- identity in a SECURITY DEFINER function (C-1 fix: p_caller_id removed).
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'create_team_with_board: no authenticated session (auth.uid() is NULL)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Authorization check via auth.uid()-derived profile.
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

  -- Name validation (L-1 fix: explicit NULL check before trim).
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

  -- Insert team.
  INSERT INTO public.teams (company_id, name)
  VALUES (p_company_id, v_trimmed_name)
  RETURNING id INTO v_team_id;

  -- Insert board — now includes created_by = auth.uid() (gap b fix).
  -- This ensures boards are tombstone-attributable after employee deletion:
  -- when a profile is hard-deleted, boards.created_by is set to NULL by the
  -- ON DELETE SET NULL FK (20260819000001), preserving the tombstone pattern
  -- described in PRD 05 FR-16. Without writing created_by here, the field
  -- would remain NULL from creation and the SET NULL on deletion would be a no-op.
  INSERT INTO public.boards (team_id, company_id, name, created_by)
  VALUES (v_team_id, p_company_id, v_trimmed_name || ' Board', v_caller_id)
  RETURNING id INTO v_board_id;

  -- Seed three columns in fixed order per PRD FR-01.
  INSERT INTO public.columns (board_id, company_id, title, position)
  VALUES
    (v_board_id, p_company_id, 'Todo',        1),
    (v_board_id, p_company_id, 'In Progress', 2),
    (v_board_id, p_company_id, 'Done',        3);

  RETURN jsonb_build_object(
    'team_id',  v_team_id,
    'board_id', v_board_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_team_with_board(uuid, text) IS
  'Atomic team creation RPC. Creates a team, its board, and the three seeded '
  'columns (Todo, In Progress, Done) in a single transaction. '
  'Caller identity derived from auth.uid() (C-1 fix: p_caller_id removed). '
  'boards.created_by is now written as auth.uid() at creation time (gap b fix '
  'from 20260820000002) to support tombstone attribution after employee deletion '
  '(PRD 05 FR-16: boards.created_by → NULL on DELETE SET NULL). '
  'SECURITY DEFINER required to INSERT into boards and columns. '
  'GRANT''d to authenticated and service_role. '
  'Returns { team_id, board_id }. ADR-0015, PRD FR-01, PRD 05 FR-16.';

-- Re-apply grants (CREATE OR REPLACE preserves them, but explicit re-grant
-- documents intent and is defensive against any future privilege reset).
REVOKE EXECUTE ON FUNCTION public.create_team_with_board(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_team_with_board(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_with_board(uuid, text) TO service_role;


-- =============================================================================
-- End of migration 20260820000002_create_team_with_board_creator.sql
-- =============================================================================
