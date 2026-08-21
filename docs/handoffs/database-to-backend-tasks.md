# Tasks Module — Database to Backend Handoff

**Migration file:** `supabase/migrations/20260820000003_tasks_schema.sql`
**Status:** DATABASE LAYER IMPLEMENTED — READY FOR BACKEND INTEGRATION
**Date:** 2026-08-21
**Prepared by:** Database Agent
**PRD:** `docs/prd/04-tasks.md`

---

## Overview

The Tasks module (PRD 04) database layer introduces the `public.tasks` table with all columns, constraints, indexes, the `updated_at` trigger, the company_id consistency trigger, and RLS policies. This is Phase 1 only: no position RPC is included (client-side MAX+1 is the locked approach). No other existing tables were modified.

---

## Files Created

| File | Description |
|---|---|
| `supabase/migrations/20260820000003_tasks_schema.sql` | Tasks table, trigger, indexes, RLS |
| `docs/handoffs/database-to-backend-tasks.md` | This file |

---

## Table Shape

### `public.tasks`

| Column | Type | Nullable | Default | FK Behavior | Notes |
|---|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | — | Primary key |
| `column_id` | `uuid` | NOT NULL | — | `ON DELETE CASCADE` to `columns.id` | Task's column; deletion cascades |
| `board_id` | `uuid` | NOT NULL | — | `ON DELETE CASCADE` to `boards.id` | Denormalized for RLS; consistency enforced by trigger |
| `company_id` | `uuid` | NOT NULL | — | `ON DELETE RESTRICT` to `companies.id` | ADR-0006 tenant scope; denormalized for RLS |
| `title` | `text` | NOT NULL | — | — | CHECK: `char_length(trim(title)) BETWEEN 1 AND 500` |
| `description` | `text` | NULL | — | — | CHECK: `IS NULL OR char_length(description) <= 5000` |
| `priority` | `text` | NOT NULL | `'medium'` | — | CHECK: `IN ('low', 'medium', 'high')` |
| `assignee_id` | `uuid` | NULL | — | `ON DELETE SET NULL` to `profiles.id` | Tombstone-first; NULL = unassigned |
| `due_date` | `date` | NULL | — | — | Date only (not timestamp); no future-only constraint |
| `position` | `integer` | NOT NULL | — | — | Client-side MAX+1; no unique constraint |
| `created_by` | `uuid` | NULL | — | `ON DELETE SET NULL` to `profiles.id` | Tombstone-first; write-once in application code |
| `created_at` | `timestamptz` | NOT NULL | `now()` | — | Set once at INSERT |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | — | Auto-updated by `tasks_updated_at` trigger |

**Named constraints:**

| Constraint name | Definition |
|---|---|
| `tasks_pkey` | `PRIMARY KEY (id)` |
| `tasks_column_id_fkey` | `FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE ON UPDATE CASCADE` |
| `tasks_board_id_fkey` | `FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE ON UPDATE CASCADE` |
| `tasks_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE CASCADE` |
| `tasks_assignee_id_fkey` | `FOREIGN KEY (assignee_id) REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE` |
| `tasks_created_by_fkey` | `FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE` |
| `tasks_title_check` | `CHECK (char_length(trim(title)) BETWEEN 1 AND 500)` |
| `tasks_description_check` | `CHECK (description IS NULL OR char_length(description) <= 5000)` |
| `tasks_priority_check` | `CHECK (priority IN ('low', 'medium', 'high'))` |

---

## Tombstone Contract Restatement

Both `assignee_id` and `created_by` reference `profiles.id` with `ON DELETE SET NULL`. This is the tombstone-first pattern established in PRD 05 for `team_members.profile_id` and `boards.created_by`.

**What this means in practice:**

1. When an employee is hard-deleted via the PRD 05 lifecycle deletion flow (`hard_delete_employee` RPC or `_promote_scheduled_deletions` cron), PostgreSQL's FK machinery fires `ON DELETE SET NULL` on all rows in `tasks` where `assignee_id` or `created_by` matches the deleted profile's UUID. The task row itself is preserved.

2. **`assignee_id = NULL` after deletion:** Frontend renders as no assignee — same UX as a task that was never assigned. MVP does not surface historical assignment; admin can re-assign manually.

3. **`created_by = NULL` after deletion:** Frontend renders as `[Deleted User]` with muted styling in any UI that surfaces creator attribution (not prominent on task cards in MVP). Match the Teams tombstone pattern.

4. **`created_by` is write-once in application code:** The `tasksService.create()` method sets `created_by` from the authenticated user's profile ID at INSERT time. No update path in the application layer should ever touch `created_by`. The only path to NULL is the FK `ON DELETE SET NULL` action.

5. **Tasks are never cascade-deleted when a creator or assignee is deleted.** If a column is deleted, its tasks ARE cascade-deleted. If a board is deleted, all its columns and tasks ARE cascade-deleted. The employee deletion path does NOT delete tasks.

---

## Position Calculation Contract

### Approach: client-side MAX+1

Phase 1 uses no position RPC. The backend agent's `SupabaseTasksRepository` (and `tasksService`) is responsible for computing the position before each INSERT or UPDATE.

**Pseudocode for `SupabaseTasksRepository.create()`:**

```typescript
async create(input: CreateTaskInput): Promise<Task> {
  // Step 1: compute the next position in the target column.
  // company_id is NEVER taken from client input — it comes from the JWT claim.
  const company_id = /* from JWT: supabase.auth.getUser() → user.app_metadata.company_id */;
  const created_by = /* from JWT: supabase.auth.getUser() → user.id */;

  const { data: positionRow } = await supabase
    .from('tasks')
    .select('position')
    .eq('column_id', input.column_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const next_position = positionRow ? positionRow.position + 1 : 1;

  // Step 2: insert with the computed position.
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      column_id:   input.column_id,
      board_id:    input.board_id,
      company_id,          // always from JWT — never from client input
      title:       input.title,
      description: input.description ?? null,
      priority:    input.priority ?? 'medium',
      due_date:    input.due_date ?? null,
      assignee_id: input.assignee_id ?? null,
      position:    next_position,
      created_by,          // always from JWT — never from client input
    })
    .select()
    .single();

  if (error) throw normalizeError(error);
  return mapToTask(data);
}
```

**For `tasksService.move(taskId, toColumnId, toPosition)`:**

```typescript
// Compute MAX(position) in the target column (excluding the task being moved)
// then set position = max + 1 (Phase 1: always append to end of target column).
const { data: maxRow } = await supabase
  .from('tasks')
  .select('position')
  .eq('column_id', toColumnId)
  .neq('id', taskId)        // exclude self in case of same-column no-op
  .order('position', { ascending: false })
  .limit(1)
  .maybeSingle();

const newPosition = maxRow ? maxRow.position + 1 : 1;
```

**Race window and accepted resolution:**

Two concurrent `create` calls in the same column will both SELECT `MAX(position) = N` before either INSERT completes. Both will INSERT with `position = N + 1`. This produces a temporary two-card tie at position N+1. The `onSettled` TanStack Query invalidation refetches the board, resolving the display order (PostgreSQL returns rows in insertion order for equal positions, which is deterministic). This is a cosmetic transient artifact, accepted per the locked Phase 1 decision.

**`company_id` sourcing rule — CRITICAL:**
`company_id` MUST be sourced from the authenticated user's JWT claim, never from client input. The client does not supply `company_id`; the repository derives it from `supabase.auth.getUser()` → `user.app_metadata.company_id`. The RLS `WITH CHECK` policy enforces this at the database layer as a secondary defense.

---

## RLS Matrix

| Principal | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| **Platform admin** (`is_platform_admin = true` in JWT) | All tasks in all companies | Allowed; `WITH CHECK` on the inserted row passes | Allowed; pre/post-update row must satisfy policy | Allowed |
| **Company admin** (JWT `role = 'admin'` and `company_id` match) | All tasks in own company | Allowed for own company; `WITH CHECK` enforces `tasks.company_id = jwt.company_id` | Allowed; `WITH CHECK` enforces company_id after update | Allowed |
| **Team member** (has a row in `team_members` for the board's team) | Tasks on boards of their teams | Allowed for accessible boards; `WITH CHECK` enforces board is accessible | Allowed; `WITH CHECK` ensures post-update task is still on an accessible board | Allowed (any task on an accessible board — PRD FR-05) |
| **Non-member / logged out** | Denied (empty result set, no error) | Denied (`42501` or `PGRST116`) | Denied | Denied |

**`WITH CHECK` behavior note (Reviewer Y2):**
- INSERT: if a team member attempts to insert a task with `board_id` pointing to a board they do not belong to, or with `company_id` that does not match their JWT, the `WITH CHECK` clause on the INSERT policy blocks it. PostgreSQL returns error code `42501` (permission denied).
- UPDATE: if a team member attempts to move a task to a board they do not belong to (by changing `board_id` or `column_id` on a move operation), the `WITH CHECK` clause blocks it. The consistency trigger `check_task_company_id_match` fires first (column_id change triggers it) and may raise a more descriptive error.

---

## Error Code Taxonomy

Normalize these at the repository layer per ADR-0004:

| PostgreSQL error code | Scenario | Repository normalization |
|---|---|---|
| `23503` (foreign_key_violation) | `column_id` does not exist; `board_id` does not exist; `assignee_id` not in profiles | Map to `NOT_FOUND` |
| `23514` (check_violation) | Title empty or > 500 chars; description > 5000 chars; invalid priority; `company_id`/`board_id` mismatch (from consistency trigger) | Map to `VALIDATION_ERROR` |
| `42501` (permission denied) | RLS policy blocks INSERT/UPDATE/DELETE | Map to `FORBIDDEN` |
| `PGRST116` (PostgREST: 0 rows from `.single()`) | SELECT by id returned no row (task deleted or not accessible) | Map to `NOT_FOUND` for `.single()` calls; empty array for list queries |
| Network / timeout | Supabase client network error | Map to `NETWORK_ERROR` or surface upstream |

Pattern for normalizing in `SupabaseTasksRepository`:

```typescript
function normalizeError(error: PostgrestError): RepositoryError {
  switch (error.code) {
    case '23503': return { type: 'NOT_FOUND',        message: error.message };
    case '23514': return { type: 'VALIDATION_ERROR', message: error.message };
    case '42501': return { type: 'FORBIDDEN',        message: error.message };
    default:      return { type: 'UNKNOWN',          message: error.message };
  }
}
```

---

## Index List with Rationale

| Index name | Columns | Type | Query pattern served |
|---|---|---|---|
| `idx_tasks_board_id` | `board_id` | B-tree | `WHERE board_id = $1` — primary read path for `getBoardWithDetails()` |
| `idx_tasks_column_id` | `column_id` | B-tree | `WHERE column_id = $1` — position calculation (`MAX(position)`), column-level invalidation |
| `idx_tasks_assignee_id` | `assignee_id WHERE IS NOT NULL` | Partial B-tree | `WHERE assignee_id = $1` — future "my tasks" views, deletion cleanup queries |
| `idx_tasks_company_id` | `company_id` | B-tree | RLS Tier-2 company-admin bypass — without this, company-admin board queries full-scan tasks |

**Existing indexes that also benefit tasks queries (from prior migrations):**

| Index | Migration | How it helps tasks |
|---|---|---|
| `idx_team_members_profile_id_team_id` | `20260809000001` | Covers `WHERE profile_id = auth.uid() AND team_id = ...` inside `is_team_member()` |
| `boards_team_id_unique` | `20260809000001` | Unique B-tree on `boards(team_id)` — covers `WHERE b.id = tasks.board_id` in Tier-3 |
| `idx_boards_company_id` | `20260809000001` | Covers `boards` lookup in Tier-3 EXISTS |

**Representative query plan for Tier-3 team-member SELECT:**

```sql
-- This is the shape of the query PostgreSQL evaluates for a team-member:
EXPLAIN SELECT *
FROM   public.tasks
WHERE  (
  EXISTS (
    SELECT 1
    FROM   public.boards b
    WHERE  b.id = tasks.board_id
      AND  public.is_team_member(b.team_id)
  )
);
-- Expected plan:
--   Seq Scan on tasks (filtered by idx_tasks_board_id via NL join into boards)
--   → Index Scan on boards using boards_pkey (b.id = tasks.board_id)
--   → is_team_member() called per distinct team_id (STABLE: result cached per team)
--     → Index Scan on team_members using idx_team_members_profile_id_team_id
--
-- Note: EXPLAIN cannot be executed in a migration script. Run manually against
-- the live database post-deploy. The indexes listed above are expected to produce
-- an index-scan plan, not a sequential scan, for a board with thousands of tasks.
```

---

## `updated_at` Trigger

| Property | Value |
|---|---|
| Trigger name | `tasks_updated_at` |
| Function | `public.handle_updated_at()` (defined in `20260802000001_auth_schema.sql`) |
| Fires on | `BEFORE UPDATE` on `public.tasks` |
| Effect | Sets `NEW.updated_at = now()` and returns `NEW` |
| No new function created | The shared function is reused — consistent with `teams_updated_at`, `boards_updated_at`, `columns_updated_at` |

---

## Consistency Trigger

| Property | Value |
|---|---|
| Trigger name | `tasks_company_id_match_check` |
| Function | `public.check_task_company_id_match()` |
| Fires on | `BEFORE INSERT OR UPDATE` on `public.tasks` |
| SECURITY DEFINER | Yes — unconditional enforcement regardless of calling session |
| `SET search_path = ''` | Yes — prevents search_path injection |

**What it enforces:**

1. `tasks.company_id` must equal `columns.company_id` for `tasks.column_id`. If they differ, raises `check_violation` (23514).
2. `tasks.board_id` must equal `columns.board_id` for `tasks.column_id`. If they differ, raises `check_violation` (23514).
3. If the column does not exist (genuinely missing FK target), raises `foreign_key_violation` (23503).

**UPDATE optimization:** On UPDATE, the check is entirely skipped when `column_id`, `company_id`, AND `board_id` are all unchanged. This means edits to `title`, `description`, `priority`, `assignee_id`, and `due_date` do NOT trigger the column lookup — the common case is zero overhead.

**Move operation:** When a task is moved to a new column (UPDATE sets `column_id`), the trigger fires and validates the new column's `company_id` and `board_id`. A cross-board move (task moved to a column on a different board) will raise `check_violation`.

---

## Smoke Tests

Run these queries immediately after applying the migration. Paste output in the deploy runbook.

**Test 1 — Table exists with expected columns:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'tasks'
ORDER  BY ordinal_position;
-- Expected: 14 rows (id, column_id, board_id, company_id, title, description,
--           priority, assignee_id, due_date, position, created_by,
--           created_at, updated_at) — verify nullable and defaults match spec.
```

**Test 2 — RLS is enabled:**
```sql
SELECT relrowsecurity, relforcerowsecurity
FROM   pg_class
WHERE  oid = 'public.tasks'::regclass;
-- Expected: relrowsecurity = true, relforcerowsecurity = false
```

**Test 3 — All 4 policies exist:**
```sql
SELECT policyname, cmd, permissive
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'tasks'
ORDER  BY policyname;
-- Expected: 4 rows — tasks_delete, tasks_insert, tasks_select, tasks_update
```

**Test 4 — Consistency trigger fires on mismatched company_id:**
```sql
-- Requires real board/column UUIDs from your environment.
-- Substitute valid UUIDs for $board_id, $column_id, $company_id.
-- Attempt to insert a task with a company_id that does not match the column's:
BEGIN;
INSERT INTO public.tasks
  (column_id, board_id, company_id, title, position)
VALUES
  (
    '<valid_column_id>',
    '<valid_board_id>',
    '00000000-0000-0000-0000-000000000099',  -- wrong company_id
    'Smoke test',
    1
  );
-- Expected: ERROR 23514 (check_violation):
-- "tasks.company_id (00000000-...-0099) must equal columns.company_id (...)"
ROLLBACK;
```

**Test 5 — WITH CHECK catches malicious insert (company_id mismatch via RLS):**
```sql
-- Simulate an authenticated user trying to insert a task with wrong company_id.
BEGIN;
SET LOCAL ROLE authenticated;
-- Set a fake JWT so auth.uid() and JWT claims are populated:
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"<some_profile_id>","app_metadata":{"company_id":"00000000-0000-0000-0000-000000000001","role":"employee","is_platform_admin":"false"}}',
  true
);
INSERT INTO public.tasks
  (column_id, board_id, company_id, title, position)
VALUES
  ('<valid_column_id>', '<valid_board_id>',
   '00000000-0000-0000-0000-000000000099',  -- different company from JWT
   'Malicious insert', 1);
-- Expected: ERROR 42501 (permission denied) — WITH CHECK blocks the insert
-- because company_id does not match JWT company_id and user is not team member.
-- NOTE: if the referenced column's company_id also differs from the row's
-- company_id, the check_task_company_id_match BEFORE trigger fires first and
-- returns 23514 (check constraint violation) instead of 42501. Either error is
-- correct behavior — both prove the malicious insert was blocked. Note which
-- code you observe and adjust the test data if you want to isolate the RLS path.
ROLLBACK;
```

**Test 6 — Service-role can SELECT from tasks (default privileges inherited):**
```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.tasks;
-- Expected: 0 rows returned (not a 42501 error). Confirms default privileges.
ROLLBACK;
```

**Test 7 — `updated_at` trigger fires:**
```sql
-- After inserting a test task (use service_role to bypass RLS):
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.tasks (column_id, board_id, company_id, title, position)
VALUES ('<col>', '<board>', '00000000-0000-0000-0000-000000000001', 'Trigger test', 999)
RETURNING id, created_at, updated_at;
-- Save the returned id.
-- Then update and check updated_at changed:
UPDATE public.tasks SET title = 'Trigger test updated' WHERE id = '<returned_id>'
RETURNING updated_at;
-- Expected: updated_at > created_at
ROLLBACK;
```

---

## Deploy Notes

### Migration deploy order

All prior migrations must be deployed before this one:

```
20260802000001_auth_schema.sql                             (deployed)
  ↓
20260802000002_jwt_sync_hook.sql                           (deployed)
  ↓
20260809000001_teams_schema.sql                            (deployed)
  ↓
20260816000001_fix_team_members_rls_recursion.sql          (deployed) ← is_team_member() helper
  ↓
20260816000002_employees_schema.sql                        (deployed)
  ↓
20260818000001_grant_service_role_table_privileges.sql     (deployed) ← default privileges
  ↓
20260819000001_team_members_surrogate_pk.sql               (deployed)
  ↓
20260819000002_employee_lifecycle_deletion.sql              (deployed)
  ↓
20260820000001_admin_employee_list_add_deletion_scheduled.sql (deployed)
  ↓
20260820000002_create_team_with_board_creator.sql           (deployed)
  ↓
20260820000003_tasks_schema.sql                             ← DEPLOY THIS
```

### No manual Dashboard steps required

- pg_cron was already enabled by `20260819000002`. No extension step needed.
- The `is_team_member()` helper was created in `20260816000001`. No new SECURITY DEFINER helper needed.
- Service-role grants are inherited from `20260818000001` via `ALTER DEFAULT PRIVILEGES`. No manual grant step.

### Rollback (dev/staging only — NEVER on production with live data)

```sql
DROP TRIGGER  IF EXISTS tasks_company_id_match_check ON public.tasks;
DROP FUNCTION IF EXISTS public.check_task_company_id_match() CASCADE;
DROP TRIGGER  IF EXISTS tasks_updated_at ON public.tasks;
DROP TABLE    IF EXISTS public.tasks CASCADE;
```

---

## Backend Implementation Guidance

### `SupabaseTasksRepository` key design points

1. **`company_id` sourcing:** Always derive from the authenticated user's JWT (`user.app_metadata.company_id`). Never accept `company_id` from client input or from a repository parameter. The RLS `WITH CHECK` enforces this at the database layer as secondary defense.

2. **`created_by` sourcing:** Always set from the authenticated user's `id` (`auth.uid()` / `user.id`) at INSERT time. Never pass it as a parameter from higher layers. Never include it in UPDATE payloads.

3. **Position calculation:** Execute a `SELECT MAX(position) FROM tasks WHERE column_id = $1` (with `.maybeSingle()`) before each INSERT or move UPDATE. Add 1 to the result (or use 1 if no rows exist). This two-step pattern is intentional — no atomic RPC exists in Phase 1.

4. **`getBoardWithDetails(boardId)`:** A single query joining `boards → columns → tasks`, ordered by `columns.position ASC, tasks.position ASC`. Use PostgREST nested selects or a raw `supabase.from('boards').select('*, columns(*, tasks(*))')`. RLS on all three tables fires automatically; only rows accessible to the calling session are returned.

5. **Error normalization:** Catch `PostgrestError` at the repository boundary and map to the error taxonomy above before returning to `TasksService`. Never let raw Supabase errors surface to hooks or components.

6. **Move operation:** `tasksService.move(taskId, toColumnId)` should:
   - Validate that `toColumnId` belongs to the same board as the task (avoid cross-board moves; the consistency trigger will block them anyway, but early validation produces a better error message).
   - Compute MAX position in `toColumnId`.
   - UPDATE `tasks SET column_id = toColumnId, position = maxPos + 1 WHERE id = taskId`.
   - The consistency trigger fires and validates `company_id` and `board_id` consistency automatically.

7. **Task list ordering:** Always order by `position ASC` when querying within a column. There is no guaranteed uniqueness on position (concurrent inserts may produce ties), but the order is deterministic and resolves on next invalidation.

### TanStack Query key convention (ADR-0013)

```typescript
export const taskKeys = {
  all:    ['tasks'] as const,
  lists:  () => [...taskKeys.all, 'list'] as const,
  list:   (boardId: string) => [...taskKeys.lists(), { boardId }] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', { id }] as const,
};
```

After create, update, move, or delete: invalidate `taskKeys.list(boardId)`.

---

## Known Limitations (Phase 1)

1. **No within-column reorder.** Position is always MAX+1 (append to end). Fine-grained reorder within a column is post-MVP.

2. **No position RPC.** Two concurrent creates in the same column produce a temporary position tie. Resolves on `onSettled` invalidation. Cosmetic, accepted.

3. **No task search.** Full-text search across tasks is post-MVP. No `GIN` index on `title`/`description` in Phase 1.

4. **No real-time sync.** Supabase Realtime for collaborative board updates is post-MVP.

5. **`assignee_id` cross-company validation.** The FK constraint ensures `assignee_id` references a valid profile UUID, but does NOT enforce that the assignee is in the same company as the task. The application layer (assignee picker filtered to `employee_directory` view, which is already company-scoped) is the sole enforcement.

   **Backend agent MUST NOT accept raw `assignee_id` from untrusted client payloads without validating it against `employee_directory` first.** A team member making a direct PostgREST call bypassing the picker can currently set `assignee_id` to any valid `profiles.id` from any company — RLS on `tasks` only checks the caller's access to the task itself, not the assignee's company.

   **Load-bearing at multi-tenancy:** This gap becomes a data integrity and privacy violation the moment a second company is onboarded. A cross-tenant `assignee_id` written today would be a live issue then. Do not ship multi-tenancy without closing this.

   **Concrete fix path (deferred):** add a `check_task_assignee_same_company` trigger mirroring `check_team_member_company_match` from `20260809000001` (BEFORE INSERT/UPDATE, verifies `assignee_id`'s company_id matches the task's company_id). Skip when `assignee_id IS NULL` (tombstone). This is the standard project pattern for cross-table constraint enforcement.

6. **`boards_select_member` coupling.** The Tier-3 RLS chain on tasks transits `boards_select_member`, which currently calls `is_team_member()` SECURITY DEFINER. This coupling is load-bearing: any future rewrite of `boards_select_member` that reintroduces a raw `SELECT FROM team_members` EXISTS would silently reintroduce recursion via the tasks policy. When editing boards RLS, preserve the `is_team_member()` call pattern and re-audit this migration.

---

## Next Steps for Backend Agent

1. Implement `TasksRepository` interface in `src/features/tasks/repositories/TasksRepository.ts`.
2. Implement `SupabaseTasksRepository` with the five methods: `getBoardWithDetails`, `create`, `update`, `move`, `delete`.
3. Implement `TasksService` wrapping the repository with position calculation and `column_id` validation on move.
4. Implement TanStack Query hooks: `useBoard`, `useCreateTask`, `useUpdateTask`, `useMoveTask`, `useDeleteTask`.
5. Wire `SupabaseTasksRepository` as the `TasksRepository` implementation in `src/lib/container.ts`.
6. Delete `src/lib/fakeApi.ts` and `src/api/board.ts` (PRD FR-10).
7. Run the smoke tests above against the deployed migration and fill in results.
