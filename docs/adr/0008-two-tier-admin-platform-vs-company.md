# ADR 0008: Two-Tier Admin — Platform vs Company

**Status:** Accepted — 2026-08-02

## Context

The product needs two distinct admin concepts that solve different problems:

- **Company admin:** manages *their own company* — invites employees, creates teams, administers boards. Scoped to one `company_id`.
- **Platform admin:** manages *the entire platform* — provisions new companies, supports customers, has cross-tenant visibility. Not scoped to any company.

Naive single-role designs (e.g. `role IN ('admin', 'super_admin', 'employee')`) conflate two orthogonal ideas:
- A user can be a company admin without being a platform admin (typical customer).
- A user can be a platform admin without being anyone's company admin (support engineer).
- A user can be both (the first user; the founder).
- A user can be neither (an employee).

A single enum forces awkward encoding and loses information.

## Decision

Two orthogonal flags on `profiles`:

- `role text CHECK (role IN ('admin', 'employee'))` — company-scoped. Determines what you can do *within your `company_id`*.
- `is_platform_admin boolean NOT NULL DEFAULT false` — platform-scoped. When true, RLS policies bypass the `company_id` filter entirely and grant read/write across all companies.

The flags are independent. Every combination is legal and meaningful.

RLS policies use `is_platform_admin` as a short-circuit:

```
(is_platform_admin) OR (company_id = jwt.company_id AND ...)
```

## Consequences

- **Positive:** Each flag has one clear meaning. No ambiguous states.
- **Positive:** Adding a support tool for platform admins doesn't require changing the company-role model.
- **Positive:** Auditing "who can access company X" and "who is a platform superuser" are two separate, simple queries.
- **Negative:** Two flags to keep in mind. Mitigated by consistent RLS policy shape.
- **Negative:** Platform-admin actions bypass RLS — this is a sensitive privilege that must be audited. Logging platform-admin actions is a future work item.

## Alternatives considered

- **Single `role` enum with `'super_admin'` value.** Rejected: conflates two orthogonal axes.
- **Separate `platform_admins` table.** Rejected: adds a join to every RLS policy for no real benefit over a boolean column.
- **Encode via team membership (a "platform" team).** Rejected: platform-admin permissions are not team permissions; different semantics.
