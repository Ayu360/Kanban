---
name: Kanban Platform Architecture
description: Key architectural decisions, conventions, and patterns for the work management platform — essential context for any DB or auth review
type: project
---

Multi-tenant SaaS work management platform (teams, boards, tasks). MVP is single-company but designed for N companies from day one.

**Why:** ADR-0006 mandates `company_id` on every business table from the start to avoid costly multi-tenancy retrofits.

**Key patterns:**
- RLS is the sole authorization enforcement layer (ADR-0003). Frontend checks are UX-only.
- Two-tier admin: `profiles.role` (company-scoped: admin/employee) + `profiles.is_platform_admin` (platform-scoped boolean). Orthogonal. ADR-0008.
- JWT carries `company_id`, `is_platform_admin`, `role` in `app_metadata` via a custom_access_token hook (migration 20260802000002). RLS reads from JWT, not the table.
- First-user-wins bootstrap: if `profiles` is empty on signup, promote to platform admin + company admin. Implemented as a SECURITY DEFINER PL/pgSQL function with an advisory lock. ADR-0014.
- Server Actions for privileged ops (invites, role changes, provisioning). ADR-0015.
- Repository pattern with swap seam (ADR-0004): only repositories touch Supabase; interfaces are feature-scoped.
- Fixed default company UUID: `00000000-0000-0000-0000-000000000001`.

**How to apply:** When reviewing any DB migration, check: company_id present and NOT NULL, RLS enabled with correct platform-admin bypass, JWT claim keys match hook injection (`app_metadata.company_id`, `app_metadata.is_platform_admin`, `app_metadata.role`), SECURITY DEFINER functions have `SET search_path = public`.
