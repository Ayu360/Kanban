# ADR 0003: RLS is the Authorization Boundary

**Status:** Accepted — 2026-08-02

## Context

The frontend and backend both have opportunities to enforce access control. Frontend checks are easy to write but easy to bypass: any authenticated user can call the Supabase client directly from the browser console. In a multi-tenant SaaS, an authorization failure means one tenant reads or writes another tenant's data — the worst possible bug class.

The system needs a single, non-bypassable authorization boundary.

## Decision

**Row-Level Security (RLS) in Postgres is the authoritative authorization boundary.** Every business table has RLS enabled with policies that enforce:

1. `company_id` scoping via a JWT claim (users only see rows for their own company).
2. Platform-admin bypass (`is_platform_admin=true` users see all rows).
3. Feature-specific rules layered on top (e.g. team membership for boards, see ADR-0009).

**Frontend authorization checks exist for UX only** — hiding buttons the user cannot use, showing "you don't have permission" states, guarding client routes. They are never the enforcement layer.

**Server Actions** (ADR-0015) that need to bypass RLS (e.g. company provisioning) use the service-role key explicitly and are audited as sensitive code paths.

## Consequences

- **Positive:** A compromised or bug-ridden frontend cannot leak cross-tenant data. The database refuses.
- **Positive:** New features get authorization "for free" as long as their tables carry `company_id` and inherit the standard policies.
- **Negative:** RLS policies are harder to read and debug than application-layer checks. This is offset by keeping policies simple and well-commented in `supabase/migrations/`.
- **Negative:** Some queries (e.g. cross-team aggregations) require careful policy design or must be moved to Server Actions with the service-role key.

## Alternatives considered

- **Application-layer authorization only.** Rejected: bypassable, and every new API endpoint becomes an audit surface.
- **Both layers as belt-and-suspenders.** Partially accepted: frontend does UX checks, backend does enforcement. The word "boundary" clarifies which one is authoritative.
