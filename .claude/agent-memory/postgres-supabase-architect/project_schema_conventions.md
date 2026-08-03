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
