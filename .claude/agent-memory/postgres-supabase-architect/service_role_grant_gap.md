---
name: Service-Role Grant Gap
description: Supabase default bootstrap grants are absent in this project; service_role requires explicit table grants or they fail with 42501
type: project
---

Supabase's default bootstrap GRANTs (which would automatically cover service_role on every
public table) are NOT present in this project. All migrations prior to 20260818000001
only granted to `authenticated`. This caused a production 42501 on any direct
service-role table write that did not go through a SECURITY DEFINER function.

**Why:** The gap was masked by the fact that all team/employee write operations
went through SECURITY DEFINER RPCs (which run as postgres/superuser and never needed
table-level grants). The addMember flow used a raw service-role INSERT and surfaced
the bug.

**Fix applied (20260818000001):**
- `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role` — covers all existing tables.
- `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role` — covers future serial PKs.
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES/SEQUENCES TO service_role` — forward-covers all future migrations.

**How to apply:** Future migrations that add new tables do NOT need to add a
`GRANT ... TO service_role` line — the `ALTER DEFAULT PRIVILEGES` in 20260818000001
handles it automatically (as long as Supabase continues to run migrations as the
`postgres` role). If a new migration creates tables under a different role, an
explicit grant is still needed.

For any new SECURITY DEFINER function that should be callable via service-role
client: still add `GRANT EXECUTE ... TO service_role` explicitly in the function's
migration — DEFAULT PRIVILEGES for functions is a separate `FOR ROLE` context and
was not set in 20260818000001 (function grants are already handled per-function).
