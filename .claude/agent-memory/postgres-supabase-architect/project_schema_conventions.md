---
name: Schema and Migration Conventions
description: Established naming conventions, table patterns, and migration structure for this project's database layer
type: project
---

# Schema Conventions (established in Auth migration, 2026-08-02)

**Migration location:** `supabase/migrations/` — timestamped, Supabase CLI convention.
**Naming pattern:** `YYYYMMDDHHMMSS_short_description.sql`

**Tables created so far:**
- `public.companies` — tenant root. No `company_id` self-reference. Has `is_active` boolean.
- `public.profiles` — extends `auth.users` (same UUID PK). Has `company_id`, `role` (text CHECK), `is_platform_admin` (boolean), `display_name` (nullable text).
- `public.teams` — (migration 20260809000001) team groupings within a company. `company_id NOT NULL`, `name text`, CHECK non-empty+max 100. Case-insensitive unique within company via expression unique index `idx_teams_company_id_name_lower` on `(company_id, lower(trim(name)))`.
- `public.team_members` — (migration 20260809000001) join table. Composite PK `(team_id, profile_id)`. FKs ON DELETE CASCADE. Cross-company membership blocked by `team_members_company_match_check` trigger. No `role` column in MVP.
- `public.boards` — (migration 20260809000001) one per team (UNIQUE team_id). `company_id NOT NULL`. FK team ON DELETE CASCADE. No direct authenticated INSERT — only via `create_team_with_board` RPC.
- `public.columns` — (migration 20260809000001) columns within boards. `company_id NOT NULL` (denormalized for RLS bypass). FK board ON DELETE CASCADE. `position integer CHECK > 0`. Seeded: 1=Todo, 2=In Progress, 3=Done. No direct authenticated INSERT.

**Tasks table:** Does NOT exist yet. When created, must add `column_id FK columns ON DELETE CASCADE` and `company_id NOT NULL`. RLS will need team-membership traversal via columns → boards → team_members.

**Unique name pattern:** Case-insensitive uniqueness within company is enforced via UNIQUE expression index `(company_id, lower(trim(name)))` — not citext, not CHECK. This is the established pattern for team names; apply to other per-company-unique name columns.

**RPC atomicity pattern:** `create_team_with_board(p_company_id uuid, p_name text)` is SECURITY DEFINER. Creates team + board + 3 columns atomically. Caller identity derived from `auth.uid()` inside the function — NO `p_caller_id` parameter (removed in C-1 security review fix to prevent privilege escalation). Authorization enforced inside function. Boards/columns have NO authenticated INSERT policy — RPC is the only creation path. GRANT EXECUTE to authenticated + service_role; REVOKE FROM PUBLIC. Old 3-argument overload `(uuid, text, uuid)` is dropped at migration head via `DROP FUNCTION IF EXISTS`.

**Default company seed:**
- UUID: `00000000-0000-0000-0000-000000000001`
- Name: `Default Company`
- Referenced in documentation as the MVP single-tenant seed.

**Naming conventions:**
- Constraints: `{table}_{column}_fkey`, `{table}_{column}_check`, `{table}_pkey`
- Indexes: `idx_{table}_{column(s)}[_{suffix}]`
- Policies: `{table}_{operation}_{scope}` (e.g. `profiles_select_own`, `profiles_select_company_admin`)
- Triggers: `{table}_updated_at`
- Functions: `snake_case`, descriptive

**Data types:**
- Primary keys: `uuid NOT NULL DEFAULT gen_random_uuid()` (or same as auth.users.id for extension tables)
- Timestamps: `timestamptz NOT NULL DEFAULT now()`
- Strings: `text` (not varchar(n))
- Role field: `text` with CHECK constraint (not enum — easier to extend)

**Role values:** `'admin'` | `'employee'` (CHECK constraint on profiles.role)

**updated_at trigger function:** `public.handle_updated_at()` — reusable, defined once in first migration.

**Multi-tenancy:** Every business table gets `company_id UUID NOT NULL REFERENCES companies(id)`.

**Why:** ADR-0006 (shape-now, seed-one). The default company UUID is a fixed constant for joinability without query.

**How to apply:** All future tables (teams, boards, columns, tasks) must include `company_id NOT NULL` and reference it in unique constraints where slug/name uniqueness is per-company.
