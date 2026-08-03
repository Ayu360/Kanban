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

## Functions

- `public.custom_access_token_hook(event jsonb)` — JWT hook, SECURITY DEFINER, reads profiles.
- `public.create_profile_for_user(p_user_id uuid, p_company_id uuid, p_display_name text)` — atomic first-user-wins bootstrap, SECURITY DEFINER, uses advisory lock.
- `public.handle_updated_at()` — trigger function for auto-updating updated_at column.

## Hook activation

`custom_access_token_hook` must be manually enabled in the Supabase Dashboard:
Authentication -> Hooks -> custom_access_token
URI: `pg-functions://postgres/public/custom_access_token_hook`

This cannot be done via SQL migration.
