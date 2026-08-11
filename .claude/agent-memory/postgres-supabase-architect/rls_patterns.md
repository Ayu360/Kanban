---
name: RLS Policy Patterns
description: Established RLS policy shapes, JWT claim access patterns, and grant conventions for this project
type: project
---

# RLS Patterns (established in Auth migration, 2026-08-02)

## JWT claim access pattern

Claims injected by `custom_access_token_hook` into `app_metadata`:

```sql
-- company_id (cast from text to uuid)
(auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid

-- is_platform_admin (cast from text to boolean)
(auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true

-- role (text, compare directly)
(auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
```

Values are stored as text in the JWT (JWT spec); consumers must cast.

## Standard three-tier policy shape (ADR-0008, ADR-0009)

```sql
-- Platform admin bypass OR company admin bypass OR specific user condition
(auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean = true
OR (
  company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
  AND (auth.jwt() -> 'app_metadata' ->> 'role')::text = 'admin'
)
OR <specific condition e.g. team membership, own row>
```

## Grant pattern

- `authenticated` role gets `SELECT, INSERT` on business tables + column-level UPDATE only.
  - For `profiles`: `GRANT SELECT, INSERT ON public.profiles TO authenticated; GRANT UPDATE (display_name) ON public.profiles TO authenticated;`
  - Column-level UPDATE grant prevents `role` and `is_platform_admin` mutations from the anon-key path at the DB layer (not just app layer). ADR-0003.
- `anon` role gets NO grant (denies before RLS evaluates).
- Service-role bypasses RLS and column-level grants entirely — no policy needed for service-role writes.
- Hook functions: `GRANT EXECUTE TO supabase_auth_admin; REVOKE EXECUTE FROM PUBLIC;`
- Bootstrap/SECURITY DEFINER functions: `GRANT EXECUTE TO service_role; REVOKE EXECUTE FROM PUBLIC;`
  - `create_profile_for_user` is service-role ONLY — authenticated role must NOT have EXECUTE. Caller must use the service-role supabase client, not the anon-key client.

## SECURITY DEFINER function search_path convention

All SECURITY DEFINER functions (and `handle_updated_at`) use `SET search_path = ''` (empty string), not `SET search_path = public`. All object references inside must be fully schema-qualified (`public.profiles`, etc.).

## RLS on companies

- SELECT own company: `id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid` (policy: `companies_select_own_company`)
- SELECT platform admin: `jwt_is_platform_admin = true` (policy: `companies_select_platform_admin`)
- INSERT/UPDATE/DELETE: no policy = service-role only (bypasses RLS)

## RLS on profiles

- SELECT own row: `id = auth.uid()`
- SELECT company admin: `company_id = jwt_company_id AND jwt_role = 'admin'`
- SELECT platform admin: `jwt_is_platform_admin = true`
- INSERT own: `id = auth.uid()` (defense-in-depth; real path is SECURITY DEFINER fn)
- UPDATE own: `id = auth.uid()` USING and WITH CHECK
- UPDATE platform admin: `jwt_is_platform_admin = true`
- DELETE: no policy (service-role only)

## SECURITY DEFINER trigger pattern (established in Teams migration, 2026-08-09)

Trigger functions that must inspect rows from parent tables (bypassing RLS) use SECURITY DEFINER + SET search_path = ''. EXECUTE on trigger functions is NOT granted to any user role — the trigger infrastructure calls them automatically using the function owner's privileges.

Pattern: cross-table invariant enforcement triggers must be SECURITY DEFINER so they see the true underlying rows regardless of the calling session's RLS context. Error distinction in such triggers:
- Genuine missing row → `RAISE EXCEPTION ... USING ERRCODE = 'foreign_key_violation'`
- Invariant violation (e.g. cross-company) → `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'`

Without SECURITY DEFINER, a cross-company attempt would hide the parent row via RLS, causing the NULL branch to fire with the wrong error code.

## Redundant index rule

B-tree composite indexes cover leading-column prefix scans. A single-column index on `company_id` is redundant when a composite index `(company_id, ...)` already exists. Drop the single-column index. Established via M-3 finding in Teams migration review.

## Functions

- `public.custom_access_token_hook(event jsonb)` — JWT hook, SECURITY DEFINER, reads profiles.
- `public.create_profile_for_user(p_user_id uuid, p_company_id uuid, p_display_name text)` — atomic first-user-wins bootstrap, SECURITY DEFINER, uses advisory lock.
- `public.handle_updated_at()` — trigger function for auto-updating updated_at column.
- `public.create_team_with_board(p_company_id uuid, p_name text)` — atomic team+board+3-columns creation RPC, SECURITY DEFINER. auth.uid() is sole identity source; no caller-supplied identity parameter.
- `public.check_team_member_company_match()` — BEFORE INSERT trigger on team_members, SECURITY DEFINER. Cross-company membership guard with error distinction.
- `public.check_board_company_id_match()` — BEFORE INSERT OR UPDATE trigger on boards, SECURITY DEFINER. Asserts boards.company_id = teams.company_id.
- `public.check_column_company_id_match()` — BEFORE INSERT OR UPDATE trigger on columns, SECURITY DEFINER. Asserts columns.company_id = boards.company_id.

## Hook activation

`custom_access_token_hook` must be manually enabled in the Supabase Dashboard:
Authentication -> Hooks -> custom_access_token
URI: `pg-functions://postgres/public/custom_access_token_hook`

This cannot be done via SQL migration.
