# Teams Database → Backend Handoff

**Migration file:** `supabase/migrations/20260809000001_teams_schema.sql`
**Status:** DATABASE LAYER IMPLEMENTED — READY FOR DATABASE RE-REVIEW
**Date:** 2026-08-09
**Prepared by:** Database Agent

---

## Overview

The Teams database layer implements the full schema for the Teams module: `teams`, `team_members`, `boards`, and `columns` tables, with all constraints, indexes, RLS policies, and the atomic team-creation RPC function. No existing tables were modified. No tasks table exists yet (see Known Limitations).

This document reflects all fixes applied in response to the Database Reviewer's CHANGES REQUIRED round. Key changes from the prior draft:

- **C-1**: `p_caller_id` parameter removed from `create_team_with_board`. Caller identity is now derived exclusively from `auth.uid()` inside the function.
- **H-1**: Table-level UPDATE grants on boards and columns replaced with column-level UPDATE grants (`name` only for boards; `title` and `position` only for columns).
- **M-1**: BEFORE INSERT OR UPDATE consistency triggers added on boards and columns to assert `company_id` matches the parent team/board.
- **M-2**: `check_team_member_company_match` converted to SECURITY DEFINER with precise error distinction: genuine missing row = `foreign_key_violation`; cross-company attempt = `check_violation`.
- **M-3**: Redundant `idx_teams_company_id` removed; `idx_teams_company_id_name_lower` already covers leading-column prefix scans.
- **L-1**: Explicit NULL check added in the RPC before trim, so NULL, empty, whitespace-only, and oversized names all raise distinct `check_violation` errors.
- **L-2**: SQL comments added to `teams_select_member` and `team_members_select_member` RLS policies documenting PostgreSQL's no-recursion guarantee for same-table subqueries.

---

## Database Objects

### Tables

| Table | Primary Key | Notable Constraints |
|---|---|---|
| `public.teams` | `id uuid` | `company_id NOT NULL FK companies`, `CHECK(char_length(trim(name)) > 0)`, `CHECK(char_length(name) <= 100)` |
| `public.team_members` | Composite `(team_id, profile_id)` | `team_id FK teams ON DELETE CASCADE`, `profile_id FK profiles ON DELETE CASCADE` |
| `public.boards` | `id uuid` | `team_id FK teams ON DELETE CASCADE`, `UNIQUE(team_id)`, `company_id NOT NULL FK companies` |
| `public.columns` | `id uuid` | `board_id FK boards ON DELETE CASCADE`, `company_id NOT NULL FK companies`, `CHECK(position > 0)` |

### Unique Constraints / Expression Indexes

| Name | Table | Definition | Purpose |
|---|---|---|---|
| `idx_teams_company_id_name_lower` | `teams` | `UNIQUE (company_id, lower(trim(name)))` | Case-insensitive unique team name within company |
| `boards_team_id_unique` | `boards` | `UNIQUE (team_id)` | One board per team invariant |

### Indexes

| Name | Table | Columns | Query Pattern |
|---|---|---|---|
| `idx_teams_company_id_name_lower` | `teams` | `(company_id, lower(trim(name)))` | Uniqueness enforcement + name search + company listing (B-tree leading-column covers `WHERE company_id = ?`) |
| `idx_team_members_profile_id_team_id` | `team_members` | `(profile_id, team_id)` | RLS EXISTS check (employee membership filter) |
| `idx_columns_board_id` | `columns` | `(board_id)` | Column listing per board |
| `idx_boards_company_id` | `boards` | `(company_id)` | RLS company-admin bypass |
| `idx_columns_company_id` | `columns` | `(company_id)` | RLS company-admin bypass |

Note: `idx_teams_company_id` (single-column on `teams.company_id`) was intentionally omitted — `idx_teams_company_id_name_lower` covers that lookup via its leading column (M-3 fix). `boards_team_id_unique` covers `boards(team_id)` lookups via the unique constraint index.

### Triggers

| Name | Table | Function | Security | Fires |
|---|---|---|---|---|
| `teams_updated_at` | `teams` | `handle_updated_at()` | INVOKER | BEFORE UPDATE |
| `boards_updated_at` | `boards` | `handle_updated_at()` | INVOKER | BEFORE UPDATE |
| `columns_updated_at` | `columns` | `handle_updated_at()` | INVOKER | BEFORE UPDATE |
| `team_members_company_match_check` | `team_members` | `check_team_member_company_match()` | SECURITY DEFINER | BEFORE INSERT |
| `boards_company_id_match_check` | `boards` | `check_board_company_id_match()` | SECURITY DEFINER | BEFORE INSERT OR UPDATE |
| `columns_company_id_match_check` | `columns` | `check_column_company_id_match()` | SECURITY DEFINER | BEFORE INSERT OR UPDATE |

### Functions

| Name | Signature | Type | Purpose |
|---|---|---|---|
| `public.create_team_with_board` | `(p_company_id uuid, p_name text)` | SECURITY DEFINER RPC | Atomic team + board + column creation |
| `public.check_team_member_company_match` | `()` | SECURITY DEFINER trigger | Prevents cross-company membership; distinguishes missing-row vs cross-company errors |
| `public.check_board_company_id_match` | `()` | SECURITY DEFINER trigger | Asserts boards.company_id = teams.company_id |
| `public.check_column_company_id_match` | `()` | SECURITY DEFINER trigger | Asserts columns.company_id = boards.company_id |

### RLS Policies

See the Authorization Model section for the full policy list. Every business table has RLS enabled with explicit policies. There are no tables without RLS in this migration.

---

## Public Database Contract

### `public.teams`

```
id          uuid        PK, gen_random_uuid()
company_id  uuid        NOT NULL, FK companies
name        text        NOT NULL, trimmed non-empty, max 100 chars
created_at  timestamptz NOT NULL DEFAULT now()
updated_at  timestamptz NOT NULL DEFAULT now()
```

Uniqueness: `lower(trim(name))` is unique within `company_id` (case-insensitive, enforced via expression index).

### `public.team_members`

```
team_id     uuid        NOT NULL, FK teams (ON DELETE CASCADE)
profile_id  uuid        NOT NULL, FK profiles (ON DELETE CASCADE)
created_at  timestamptz NOT NULL DEFAULT now()
PK: (team_id, profile_id)
```

No role column in MVP. Cross-company membership is blocked at the DB level by the `team_members_company_match_check` trigger (SECURITY DEFINER — see M-2 section).

### `public.boards`

```
id          uuid        PK, gen_random_uuid()
team_id     uuid        NOT NULL, FK teams (ON DELETE CASCADE), UNIQUE
company_id  uuid        NOT NULL, FK companies
name        text        NOT NULL, non-empty
created_at  timestamptz NOT NULL DEFAULT now()
updated_at  timestamptz NOT NULL DEFAULT now()
```

UNIQUE(team_id) enforces one board per team.
`boards.company_id` is kept consistent with `teams.company_id` by the `boards_company_id_match_check` trigger (M-1 fix).

### `public.columns`

```
id          uuid        PK, gen_random_uuid()
board_id    uuid        NOT NULL, FK boards (ON DELETE CASCADE)
company_id  uuid        NOT NULL, FK companies
title       text        NOT NULL, non-empty
position    integer     NOT NULL, > 0
created_at  timestamptz NOT NULL DEFAULT now()
updated_at  timestamptz NOT NULL DEFAULT now()
```

Seeded columns: position 1 = "Todo", position 2 = "In Progress", position 3 = "Done".
`columns.company_id` is kept consistent with `boards.company_id` by the `columns_company_id_match_check` trigger (M-1 fix).

---

## Authorization Model

### Three-Tier Policy Shape (ADR-0008, ADR-0009)

All four tables follow this pattern from the JWT claims injected by `custom_access_token_hook`:

```
-- Platform admin (cross-company bypass)
(auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true

-- Company admin (company-scoped bypass)
OR (
  company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
  AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
)

-- Employee (team membership filter)
OR EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.profile_id = auth.uid()
  AND tm.team_id = <the board/team's team_id>
)
```

### Access by Role

**Employee (`role = 'employee'`)**
- Can SELECT teams they have a `team_members` row for
- Can SELECT team_members rows for teams they belong to (to see fellow members)
- Can SELECT boards for teams they belong to
- Can SELECT columns for boards of teams they belong to
- Cannot INSERT, UPDATE, or DELETE on teams, boards, columns
- Cannot INSERT or DELETE on team_members

**Company Admin (`role = 'admin'`)**
- Can SELECT all teams, boards, columns, team_members within their `company_id`
- Can INSERT teams (scoped to their `company_id` via WITH CHECK)
- Can UPDATE (rename) teams within their `company_id`
- Can DELETE teams within their `company_id`
- Can INSERT team_members (scoped to teams within their company)
- Can DELETE team_members (scoped to teams within their company)
- Can UPDATE `boards.name` (only) within their company — structural columns `team_id`, `company_id`, `id` are NOT writable from the authenticated role (H-1 fix: column-level grant)
- Can UPDATE `columns.title` and `columns.position` (only) within their company — structural columns `board_id`, `company_id`, `id` are NOT writable from the authenticated role (H-1 fix: column-level grant)
- CANNOT directly INSERT boards or columns (no INSERT policy) — this happens only via the RPC
- CANNOT UPDATE `boards.team_id`, `boards.company_id`, `boards.id` — column-level grant restriction
- CANNOT UPDATE `columns.board_id`, `columns.company_id`, `columns.id` — column-level grant restriction

**Platform Admin (`is_platform_admin = true`)**
- Can SELECT all teams, boards, columns, team_members across all companies
- Can INSERT, UPDATE, DELETE teams in any company
- Can INSERT, DELETE team_members in any company
- Can UPDATE `boards.name` in any company (same column-level restriction applies from the authenticated role path)
- Can UPDATE `columns.title` and `columns.position` in any company (same column-level restriction)
- CANNOT directly INSERT boards or columns (no INSERT policy) — must use the RPC

**Service Role (Server Actions using service-role client)**
- Bypasses RLS entirely
- Bypasses column-level grants entirely — can UPDATE any column on boards and columns
- Used for: team deletion (`deleteTeamAction`), member add/remove, any structural mutations
- Service-role is the ONLY path that can mutate structural columns like `boards.team_id` or `columns.board_id`

### Column-Level UPDATE Grant Contract (H-1 fix)

```sql
-- boards: only the name column is writable via the authenticated role (anon-key path)
GRANT SELECT ON public.boards TO authenticated;
GRANT UPDATE (name) ON public.boards TO authenticated;

-- columns: only title and position are writable via the authenticated role (anon-key path)
GRANT SELECT ON public.columns TO authenticated;
GRANT UPDATE (title, position) ON public.columns TO authenticated;
```

Attempting to UPDATE `boards.team_id`, `boards.company_id`, `columns.board_id`, or `columns.company_id` from an anon-key session fails at the grant layer before RLS evaluates. Service-role bypasses this restriction and retains full write access.

---

## company_id Consistency Triggers (M-1 fix)

Two SECURITY DEFINER triggers enforce that the denormalized `company_id` column on `boards` and `columns` never drifts from the parent table's `company_id`. This is critical because `company_id` is the RLS enforcement column — drift creates tenant isolation holes.

### `check_board_company_id_match` (fires BEFORE INSERT OR UPDATE on boards)

Asserts: `NEW.company_id = (SELECT company_id FROM public.teams WHERE id = NEW.team_id)`

- If the parent team is not found: raises `foreign_key_violation` (23503)
- If `company_id` does not match: raises `check_violation` (23514) with message `boards.company_id (X) must equal teams.company_id (Y) for team_id=Z`

### `check_column_company_id_match` (fires BEFORE INSERT OR UPDATE on columns)

Asserts: `NEW.company_id = (SELECT company_id FROM public.boards WHERE id = NEW.board_id)`

- If the parent board is not found: raises `foreign_key_violation` (23503)
- If `company_id` does not match: raises `check_violation` (23514) with message `columns.company_id (X) must equal boards.company_id (Y) for board_id=Z`

Both functions use `SET search_path = ''` and fully qualified references. `EXECUTE` on trigger functions is not granted to invoking users — the trigger infrastructure calls them using the function owner's privileges (SECURITY DEFINER). No `GRANT EXECUTE` to any user role is needed or appropriate.

---

## Cross-Company Membership Guard (M-2 fix)

The `check_team_member_company_match` trigger function is SECURITY DEFINER with `SET search_path = ''`. This is required so the trigger can read the underlying `company_id` from both `teams` and `profiles` without RLS filtering hiding rows.

Without SECURITY DEFINER, a company-A admin attempting to insert a profile from company B into a company-A team would cause the trigger to see `NULL` for the hidden team row, incorrectly raising `foreign_key_violation` (23503) instead of the correct `check_violation` (23514).

### Error codes raised by `check_team_member_company_match`

| Condition | Error Code | Message pattern |
|---|---|---|
| team or profile row genuinely does not exist | `foreign_key_violation` (23503) | `team_members cross-company guard: team or profile not found (team_id=X, profile_id=Y)` |
| team and profile exist but belong to different companies | `check_violation` (23514) | `Cross-company team membership is not allowed: team belongs to company X, profile belongs to company Y` |

The FK constraints on `team_id` and `profile_id` also enforce referential integrity, but the trigger fires earlier and produces a more informative message.

---

## Team Creation

### Atomicity Guarantee

Team creation is **guaranteed atomic at the database level** by the `create_team_with_board` SECURITY DEFINER RPC function. A team cannot exist without its board and three columns because the entire creation happens in a single PostgreSQL transaction managed by the function.

### RPC Function: `create_team_with_board`

**C-1 security fix — `p_caller_id` removed:**
The original design accepted `p_caller_id uuid` and used it to look up the caller's role and company. Because the function is SECURITY DEFINER, any authenticated user could pass a different user's UUID (e.g., an admin's UUID discoverable via the `team_members` SELECT policy) and impersonate that user to bypass authorization. The parameter has been removed entirely. The function now calls `auth.uid()` directly, which reads the JWT of the current session and cannot be spoofed by any caller-supplied argument.

**Final function signature:**
```sql
public.create_team_with_board(
  p_company_id  uuid,   -- company to create team in
  p_name        text    -- team name (trimmed and validated inside)
) RETURNS jsonb
```

There is NO `p_caller_id` parameter. The Backend Agent must not pass it.

**Returns on success:**
```json
{
  "team_id": "<uuid>",
  "board_id": "<uuid>"
}
```

**Raises exception on failure** — the entire transaction rolls back automatically. No partial state is possible.

**Authorization (enforced inside the function using `auth.uid()`):**
- `auth.uid()` is called inside the SECURITY DEFINER function — it returns the JWT subject of the calling session, not the function owner.
- The function looks up `public.profiles` where `id = auth.uid()` to retrieve `role`, `is_platform_admin`, and `company_id`.
- Caller must be `is_platform_admin = true` OR (`role = 'admin'` AND `company_id = p_company_id`)
- If `auth.uid()` is NULL (no authenticated session): raises `insufficient_privilege`
- If the profile is not found: raises `insufficient_privilege`
- If authorization fails: raises `insufficient_privilege`

**Validation (enforced inside the function — L-1 fix):**

All four input failure modes raise `check_violation` (23514) with distinct messages:

| Condition | Error Code | Message |
|---|---|---|
| `p_name IS NULL` | `check_violation` (23514) | `Team name cannot be null` |
| `trim(p_name) = ''` (empty or whitespace-only) | `check_violation` (23514) | `Team name cannot be empty after trimming whitespace` |
| `char_length(trim(p_name)) > 100` | `check_violation` (23514) | `Team name exceeds maximum length of 100 characters` |
| Duplicate name (case-insensitive within company) | `unique_violation` (23505) | PostgreSQL unique index violation on `idx_teams_company_id_name_lower` |

**Board name:** `<trimmed_team_name> Board` (e.g. "Engineering Board")

**Seeded columns (fixed, per PRD FR-01):**
- Position 1: "Todo"
- Position 2: "In Progress"
- Position 3: "Done"

**Exact backend call site:**
```typescript
const { data, error } = await supabase.rpc('create_team_with_board', {
  p_company_id: companyId,
  p_name: teamName,
  // DO NOT pass p_caller_id — it has been removed (C-1 security fix)
});
// data = { team_id: string, board_id: string }
```

The Server Action may use either the anon-key client (authenticated session) or the service-role client. The authorization checks inside the function gate misuse either way. Per ADR-0015, using the service-role client is preferred for privileged creation operations.

**Why SECURITY DEFINER is necessary:**
Boards and columns have NO authenticated INSERT RLS policy. This is a deliberate design decision — boards should only be created as part of team creation, never as standalone client operations. The SECURITY DEFINER function is the single insertion path into those tables, enforcing the one-board-per-team invariant at the database level.

**Grant state for `create_team_with_board(uuid, text)`:**
- `GRANT EXECUTE TO authenticated` — allows anon-key Server Actions to call via `supabase.rpc()`
- `GRANT EXECUTE TO service_role` — allows service-role Server Actions to call
- `REVOKE EXECUTE FROM PUBLIC` — defense-in-depth; no unauthenticated access

**Old overload removal:**
The migration includes `DROP FUNCTION IF EXISTS public.create_team_with_board(uuid, text, uuid)` before the `CREATE OR REPLACE`. This ensures no 3-argument overload can exist, even if applied against a database that had a partial prior draft. The only callable overload after this migration is `(uuid, text)`.

---

## Team Deletion

### Cascade Chain

Deleting a `teams` row produces this cascade:

```
teams → (ON DELETE CASCADE) → boards
                           → team_members

boards → (ON DELETE CASCADE) → columns
                            → tasks (FUTURE — not yet implemented)
```

A team deletion removes: the team row, its board row, all column rows, and all team_member rows for that team. Tasks will be removed once the tasks migration adds `ON DELETE CASCADE` from columns.

**Recommended Server Action pattern (ADR-0015):**
```typescript
// Use service-role client for the delete — cascades all children atomically
const { error } = await supabaseServiceRole
  .from('teams')
  .delete()
  .eq('id', teamId)
  .eq('company_id', callerCompanyId);  // belt-and-suspenders check
```

The DELETE RLS policy on teams also scopes deletion to the caller's company (for company admin) or allows all (for platform admin), so the service-role path still benefits from an explicit `company_id` filter as an application-layer safeguard.

---

## Membership

### Adding a Member (`team_members` INSERT)

```typescript
const { error } = await supabase
  .from('team_members')
  .insert({ team_id: teamId, profile_id: profileId });
```

**Database-level protections:**
1. RLS INSERT policy: only company admin (within their company) or platform admin
2. `team_members_company_match_check` trigger (SECURITY DEFINER): profile and team must share the same `company_id`. Produces precise `check_violation` (23514) for cross-company attempts regardless of RLS visibility.
3. Composite PK: duplicate `(team_id, profile_id)` raises unique violation (idempotent insert: use `ON CONFLICT DO NOTHING` in the Server Action)

**Cross-company protection:** The trigger fires synchronously before the INSERT commits. Any attempt to add a profile from Company B to a team in Company A fails with a `check_violation` (23514) at the DB level, regardless of who is making the request. The trigger's SECURITY DEFINER ensures it always sees the real company_id values even when RLS would hide rows.

### Removing a Member (`team_members` DELETE)

```typescript
const { error } = await supabase
  .from('team_members')
  .delete()
  .eq('team_id', teamId)
  .eq('profile_id', profileId);
```

Access is revoked **immediately** after the DELETE commits. The next authenticated query from the removed employee will find no team_members row and the RLS filter will exclude the team/board/columns from results. No cache invalidation on the server is needed — RLS enforces this at query time (per ADR-0009).

---

## Backend Integration Requirements

The Backend Agent must implement the following. None of this is implemented here (database layer only).

### 1. `TeamsRepository` interface
File: `src/features/teams/repositories/TeamsRepository.ts`

Methods (minimum per PRD Backend Requirements):
- `listByCompany(companyId: string): Promise<Team[]>`
- `getById(teamId: string): Promise<Team>`
- `create(input: { companyId: string; name: string }): Promise<{ teamId: string; boardId: string }>`
- `rename(teamId: string, newName: string): Promise<Team>`
- `delete(teamId: string): Promise<void>`
- `listMembers(teamId: string): Promise<TeamMember[]>`
- `addMember(teamId: string, profileId: string): Promise<void>`
- `removeMember(teamId: string, profileId: string): Promise<void>`

Note: `create` no longer takes a `callerId` parameter — the RPC derives caller identity from `auth.uid()` automatically (C-1 fix).

### 2. `SupabaseTeamsRepository` implementation
File: `src/features/teams/repositories/SupabaseTeamsRepository.ts`

- `create` must call `supabase.rpc('create_team_with_board', { p_company_id, p_name })`. Do NOT pass `p_caller_id` — the parameter no longer exists (C-1 fix). Do NOT implement separate inserts to teams/boards/columns — only the RPC provides the atomicity guarantee.
- `addMember` should use `ON CONFLICT DO NOTHING` (idempotent per PRD FR-04).
- All Supabase errors (including unique constraint violations) must be caught and normalized to the project error type before surfacing to service/hook layers (ADR-0004).

### 3. `TeamsService`
File: `src/features/teams/services/teamsService.ts`

- Orchestrates business rules on top of repository calls.
- Validates name uniqueness error from the unique index violation (`unique_violation` 23505) and converts to a user-friendly message.
- Validates caller authorization before delegating to repository (belt-and-suspenders; RLS and the RPC do DB-layer enforcement).

### 4. Server Actions
File: `src/features/teams/services/teamsActions.ts`

Required actions (per PRD Backend Requirements and ADR-0015):
- `createTeamAction`: calls `create_team_with_board` RPC — pass only `{ p_company_id, p_name }`. Do NOT pass `p_caller_id` (removed in C-1 fix). Auth is derived from the session JWT inside the function.
- `deleteTeamAction`: deletes team via service-role client (triggers cascade)
- `addTeamMemberAction`: inserts into `team_members` via service-role client
- `removeTeamMemberAction`: deletes from `team_members` via service-role client

Team rename (`renameTeamAction`) can be a direct client-side Supabase mutation per PRD FR-02 (RLS enforces authorization). Only `name` is permitted — column-level grant enforces this at the database layer.

### 5. TanStack Query hooks
Location: `src/features/teams/hooks/`

Query keys (per ADR-0013 convention `[feature, entity, scope, params]`):
- `['teams', 'list', { companyId }]`
- `['teams', 'detail', { teamId }]`
- `['teams', 'members', { teamId }]`

Cache invalidation: after any team mutation, invalidate `['teams']`. After member add/remove, also invalidate `['teams', 'members', { teamId }]`.

### 6. Error handling

| DB Error Code | Condition | User Message |
|---|---|---|
| `unique_violation` (23505) | Duplicate team name (case-insensitive within company) | "A team with this name already exists." |
| `check_violation` (23514) from RPC | NULL / empty / whitespace-only team name | Surface the RPC's message or normalize to "Team name is required." |
| `check_violation` (23514) from RPC | Name > 100 chars | "Team name cannot exceed 100 characters." |
| `check_violation` (23514) from trigger | Cross-company membership attempt | "Cannot add a member from a different company." |
| `insufficient_privilege` (42501) from RPC | Unauthenticated call or wrong role | Surface as an authorization error; do not expose internal detail. |

Raw PostgreSQL error messages must never surface to the UI.

---

## Known Limitations

### Tasks table not yet implemented

The cascade chain `columns → tasks` is not wired yet because the `tasks` table does not exist as of this migration. When the Tasks module migration is written, it must:
- Define `tasks.column_id UUID NOT NULL FK columns(id) ON DELETE CASCADE`
- Define `tasks.company_id UUID NOT NULL FK companies(id)`
- Enable RLS on tasks with the same three-tier pattern (team membership via columns → boards → team_members)

Until then, deleting a team will delete its board and columns but tasks (when added) would be blocked from deletion unless the FK is set up correctly.

### No per-team roles in MVP

`team_members` has no `role` column. The PRD explicitly defers this to post-MVP. Adding it later is a simple `ALTER TABLE team_members ADD COLUMN role text NOT NULL DEFAULT 'member'` migration.

### Platform admin cross-company member add

The PRD states: "A platform admin adding members across companies is a post-MVP scenario and is not handled in MVP." The cross-company guard trigger blocks this even for platform admins. If this is ever needed, the trigger must be updated to allow platform admin bypass.

### Board name default

Board name is set to `<team_name> Board` inside the RPC. If the product requires a configurable board name at creation time, the `create_team_with_board` RPC signature should be extended with an optional `p_board_name text` parameter.

---

## Important Assumptions

1. `public.companies`, `public.profiles`, and `public.handle_updated_at()` already exist (migration 20260802000001).
2. The `custom_access_token_hook` is active and injecting `company_id`, `role`, and `is_platform_admin` into JWT `app_metadata` (migration 20260802000002 + Dashboard configuration).
3. The Default Company UUID `00000000-0000-0000-0000-000000000001` exists and is referenced by all MVP profiles.
4. `pgcrypto` extension is present (`gen_random_uuid()` — already guarded in migration 20260802000001).
5. The authenticated role's JWT contains valid `app_metadata` claims. If the JWT is stale (role changed but JWT not refreshed), RLS will use the stale role until the next token refresh. This is documented behavior per ADR-0007.
6. `auth.uid()` inside a SECURITY DEFINER function returns the JWT subject (the caller), not the function owner. This is correct PostgreSQL behavior and the intended mechanism for identity derivation in C-1's fix.

---

## Verification Performed

The following verifications are **structural/logical** — they were performed by code review of the migration SQL, not by running the migration against a live database. The Backend Agent should run integration tests after deploying the migration.

### C-1 — Privilege escalation fix verified by inspection

- Line 1117: `DROP FUNCTION IF EXISTS public.create_team_with_board(uuid, text, uuid)` removes any old 3-argument overload before `CREATE OR REPLACE`.
- Lines 1119–1122: New function signature is `(p_company_id uuid, p_name text)` with no `p_caller_id` parameter.
- Line 1143: `v_caller_id := auth.uid()` is the sole identity derivation — no caller-supplied parameter is used anywhere in the function body.
- Lines 1252, 1255, 1259: GRANT/REVOKE statements reference the 2-argument signature `(uuid, text)` — the 3-argument overload is fully excluded.
- Result: an authenticated user cannot supply a different user's UUID. `auth.uid()` cannot be spoofed via a function parameter.

### H-1 — Column-level UPDATE grant verified by inspection

- Line 1033: `GRANT SELECT ON public.boards TO authenticated` — no table-level UPDATE.
- Line 1034: `GRANT UPDATE (name) ON public.boards TO authenticated` — only `name` is writable.
- Line 1038: `GRANT SELECT ON public.columns TO authenticated` — no table-level UPDATE.
- Line 1039: `GRANT UPDATE (title, position) ON public.columns TO authenticated` — only `title` and `position` are writable.
- No table-level `GRANT UPDATE ON public.boards TO authenticated` or `GRANT UPDATE ON public.columns TO authenticated` appears anywhere in the file.
- Result: `boards.team_id`, `boards.company_id`, `columns.board_id`, `columns.company_id` cannot be mutated from the anon-key path at the grant layer, regardless of RLS policy wording.

### M-1 — company_id consistency triggers verified by inspection

- Lines 382–423: `check_board_company_id_match()` is `SECURITY DEFINER`, `SET search_path = ''`, fires `BEFORE INSERT OR UPDATE ON public.boards`. Checks `NEW.company_id <> v_team_company_id` and raises `check_violation`.
- Lines 432–470: `check_column_company_id_match()` is `SECURITY DEFINER`, `SET search_path = ''`, fires `BEFORE INSERT OR UPDATE ON public.columns`. Checks `NEW.company_id <> v_board_company_id` and raises `check_violation`.
- Both functions fully qualify all table references (`public.teams`, `public.boards`).
- Result: inserting or updating a board with a mismatched company_id, or a column with a mismatched company_id, raises an immediate error before the row is written.

### M-2 — Cross-company membership error precision verified by inspection

- Lines 295–345: `check_team_member_company_match()` is `SECURITY DEFINER`, `SET search_path = ''`, fires `BEFORE INSERT ON public.team_members`.
- Lines 324–329: NULL branch (genuine missing row) raises `foreign_key_violation` (23503).
- Lines 336–341: Mismatch branch raises `check_violation` (23514) with the message "Cross-company team membership is not allowed...".
- SECURITY DEFINER ensures RLS does not hide the team row during a cross-company attempt, so the function reaches the mismatch branch rather than the NULL branch.
- Result: cross-company attempts now receive `check_violation` (23514) rather than a misleading `foreign_key_violation` (23503).

### M-3 — Redundant index removed verified by inspection

- Searched entire file for `CREATE INDEX idx_teams_company_id` — not found.
- `idx_teams_company_id_name_lower` at line 482 has `company_id` as its leading B-tree column and covers `WHERE company_id = ?` prefix scans.
- Result: no redundant index exists. Write overhead is reduced with no loss of read coverage.

### L-1 — NULL/blank/oversized validation verified by inspection

- Line 1186: `IF p_name IS NULL THEN RAISE EXCEPTION 'Team name cannot be null' USING ERRCODE = 'check_violation';` — explicit NULL guard before `trim()`.
- Line 1193: `IF char_length(v_trimmed_name) = 0 THEN` — catches empty string and whitespace-only after trim.
- Line 1198: `IF char_length(v_trimmed_name) > 100 THEN` — catches oversized name.
- All three branches raise `check_violation` with distinct messages.
- Result: NULL, empty, whitespace-only, and oversized names produce normalized validation errors rather than raw NOT NULL constraint violations.

### L-2 — RLS self-reference comment verified by inspection

- Lines 592–614: `teams_select_member` policy comment explains that the EXISTS subquery on `public.team_members` does not re-enter the outer policy (no recursion).
- Lines 730–751: `team_members_select_member` policy comment makes the same point for the self-referential subquery on `public.team_members tm_self`.
- Result: the non-obvious behavior is documented inline for future maintainers.

### Integration tests the Backend Agent should run

After deploying:

1. **Team isolation**: Sign in as Employee A (member of Team A). Query `teams`. Assert Team B is not returned.
2. **Company admin access**: Sign in as company admin. Query `teams`. Assert all teams in their company are returned. Assert teams from another company (if one exists in test data) are not returned.
3. **Platform admin**: Sign in as platform admin. Query `teams`. Assert teams from all companies are returned.
4. **Duplicate team name (same company)**: Call `create_team_with_board` twice with name "Engineering". Assert second call fails with `unique_violation` (23505).
5. **Duplicate team name (different company)**: Same name in two different companies. Assert both succeed.
6. **Case-insensitive duplicate**: Create "Engineering" then attempt "engineering" in the same company. Assert second fails with `unique_violation` (23505).
7. **NULL team name**: Call `create_team_with_board` with `p_name = null`. Assert `check_violation` (23514) with "cannot be null".
8. **Empty team name**: Call with `p_name = '   '` (whitespace only). Assert `check_violation` (23514) with "cannot be empty after trimming".
9. **Oversized team name**: Call with a name of 101 chars. Assert `check_violation` (23514) with "exceeds maximum length".
10. **Cross-company membership**: Attempt to insert into `team_members` linking a profile from Company B to a team in Company A. Assert `check_violation` (23514) with "Cross-company" message (not `foreign_key_violation`).
11. **Second board for same team**: Attempt to insert a second row into `boards` with the same `team_id`. Assert unique violation.
12. **Employee cannot add member**: Sign in as employee. Attempt to INSERT into `team_members`. Assert RLS rejection.
13. **Employee cannot create team**: Sign in as employee. Attempt to INSERT into `teams`. Assert RLS rejection.
14. **boards.team_id not updatable**: As company admin via anon-key, attempt `UPDATE boards SET team_id = '<other_uuid>'`. Assert column-level grant rejection.
15. **boards.company_id not updatable**: As company admin via anon-key, attempt `UPDATE boards SET company_id = '<other_uuid>'`. Assert column-level grant rejection.
16. **boards.name is updatable**: As company admin via anon-key, attempt `UPDATE boards SET name = 'New Name'`. Assert success (subject to RLS).
17. **columns.board_id not updatable**: As company admin via anon-key, attempt `UPDATE columns SET board_id = '<other_uuid>'`. Assert column-level grant rejection.
18. **columns.title is updatable**: As company admin via anon-key, attempt `UPDATE columns SET title = 'Backlog'`. Assert success (subject to RLS).
19. **boards company_id consistency**: Attempt to INSERT a board with `company_id` differing from `teams.company_id`. Assert `check_violation` (23514).
20. **columns company_id consistency**: Attempt to INSERT a column with `company_id` differing from `boards.company_id`. Assert `check_violation` (23514).
21. **Team deletion cascade**: Delete a team. Assert board, columns, and team_members rows for that team are also deleted.
22. **Membership removal revokes access**: Add Employee A to Team B. Verify access. Remove Employee A from Team B. Re-query `teams` as Employee A. Assert Team B is no longer returned.
23. **Atomic creation**: Verify calling `create_team_with_board` creates exactly one team row, one board row, and three column rows in a single call, and that no partial state exists if an error is injected mid-function.
24. **Privilege escalation blocked**: As an employee, call `create_team_with_board` with `p_company_id` = own company but using the service-role session. Assert the function still derives identity from `auth.uid()` and rejects the call if the employee's JWT role is not `admin`.

---

## Next Steps

1. Deploy migration `20260809000001_teams_schema.sql` to the development Supabase project.
2. Implement `TeamsRepository`, `SupabaseTeamsRepository`, `TeamsService`, and Server Actions per the Backend Integration Requirements above.
3. When implementing `createTeamAction`, pass only `{ p_company_id, p_name }` to `supabase.rpc()`. The `p_caller_id` parameter no longer exists.
4. Run the integration test suite against the live migration.
5. Once the Tasks module migration is ready, wire `tasks.column_id FK columns ON DELETE CASCADE` to complete the deletion cascade chain.
6. Create `docs/handoffs/backend-to-frontend-teams.md` when backend implementation is complete.
