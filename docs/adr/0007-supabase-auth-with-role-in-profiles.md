# ADR 0007: Supabase Auth with Role in `profiles`

**Status:** Accepted — 2026-08-02

## Context

Supabase Auth manages authentication (email/password, session tokens, cookies) and stores users in the `auth.users` schema. Application-specific fields — display name, company membership, role — do not belong there. A separate `profiles` table in the public schema is the standard Supabase pattern.

The team needs to decide where `role` lives (Supabase user metadata vs. `profiles` column) and how it is shaped.

## Decision

- Every `auth.users` row has a corresponding `profiles` row keyed by the same `id` (FK to `auth.users.id`).
- `profiles.role text CHECK (role IN ('admin', 'employee'))` holds the **company-scoped** application role.
- `profiles.company_id UUID NOT NULL REFERENCES companies(id)` scopes the user to a tenant.
- `profiles.is_platform_admin boolean NOT NULL DEFAULT false` holds the orthogonal platform-superuser flag (see ADR-0008).
- Role and admin flags are **not** stored in Supabase Auth user metadata. They live in `profiles` where they can be constrained, queried, and joined.
- The relevant values (`company_id`, `is_platform_admin`) are copied into the JWT via a Supabase auth hook or database trigger so RLS policies can read them from `auth.jwt()` without extra queries.

## Consequences

- **Positive:** Roles are database-constrained (`CHECK`) and queryable.
- **Positive:** Clean separation: Supabase Auth owns credentials and sessions; the app owns identity beyond that.
- **Positive:** Adding new roles later is a `CHECK` constraint change, not a metadata migration.
- **Negative:** Requires an auth hook / trigger to sync `company_id` and `is_platform_admin` into the JWT. Standard Supabase pattern; adds one moving piece.
- **Negative:** Any change to `is_platform_admin` requires the user to re-login (or the JWT to be refreshed) to take effect. Acceptable.

## Alternatives considered

- **Store role in Supabase Auth user metadata.** Rejected: unconstrained, un-typed, hard to query, hard to join.
- **Separate `user_roles` table.** Rejected: over-engineered for two boolean/enum fields on a 1:1 profile.
