# ADR 0006: `company_id` on Every Business Table from Day One

**Status:** Accepted — 2026-08-02

## Context

The MVP serves a single company. It would be simpler in the short term to omit `company_id` and add it later when true multi-tenancy is needed. However, retrofitting a tenant discriminator across a live schema is one of the most expensive migrations a SaaS can do:

- Every table needs a new NOT NULL column with a valid backfill.
- Every query, every ORM call, every RLS policy must be rewritten to include it.
- Any bug in the retrofit is a cross-tenant data leak.

The alternative is to carry the column from day one when there is no data to backfill and no cross-tenant risk to worry about.

## Decision

**Shape-now, seed-one:**

- Every business table has `company_id UUID NOT NULL REFERENCES companies(id)` from the initial migration.
- Every RLS policy filters on `company_id` via a JWT claim from day one.
- A single row is inserted into `companies` for the MVP (id `'default'` or similar). All users, teams, boards, and tasks reference it.
- The UI does not expose company-switching or company-selection concepts until multi-tenancy is turned on.

Turning on true multi-tenancy is then a data-load exercise: provision new `companies` rows, invite users into them, done. No schema change. No RLS rewrite.

## Consequences

- **Positive:** Multi-tenancy becomes a configuration flip and a UI project, not a database migration.
- **Positive:** RLS policies are correct from day one — no window where cross-tenant queries "would work if there were more tenants."
- **Positive:** Backend engineers cannot forget to include the tenant scope; the FK forces awareness.
- **Negative:** Every migration and query is very slightly more verbose. Trivial cost.
- **Negative:** A single seeded row is a magic constant. Mitigated by naming it clearly (`Default Company`) and documenting it in `supabase/migrations/`.

## Alternatives considered

- **Add `company_id` later.** Rejected: high-risk, high-effort migration once real data exists. This is the exact bad-migration scenario the shape-now strategy avoids.
- **Separate database per company.** Rejected: massive operational overhead; not viable for a small team, and precludes cross-company platform-admin features.
- **Schema-per-company in shared database.** Rejected: complex RLS story, painful cross-tenant reporting.
