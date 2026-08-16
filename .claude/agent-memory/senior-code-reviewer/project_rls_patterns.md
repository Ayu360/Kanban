---
name: RLS Recursion Fix Pattern
description: SECURITY DEFINER helper pattern used to break self-referential RLS recursion on team_members; established as project convention in migration 20260816000001
type: project
---

Self-referential RLS recursion was fixed in `20260816000001_fix_team_members_rls_recursion.sql` via a `public.is_team_member(_team_id uuid) RETURNS boolean SECURITY DEFINER STABLE SET search_path = ''` helper. The pattern is now codified in `rls_patterns.md` in the architect's memory.

**Why:** PostgreSQL re-enters all active permissive policies when a subquery inside a policy expression touches the same table — contrary to the comment in the original migration. Runtime error `42P17` confirmed this.

**How to apply:** Any future RLS policy that would query the same table it is defined on MUST use a SECURITY DEFINER helper function instead of an inline subquery. This is the established project convention (see `rls_patterns.md` in architect agent memory at `.claude/agent-memory/postgres-supabase-architect/rls_patterns.md`).

Grant surface for such helpers: `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated`. Service-role does not need the grant (bypasses RLS entirely). Anon needs no grant (no business table access).
