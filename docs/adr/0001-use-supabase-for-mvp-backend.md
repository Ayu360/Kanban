# ADR 0001: Use Supabase for the MVP Backend

**Status:** Accepted — 2026-08-02

## Context

The project needs a backend that provides authentication, a relational database, row-level authorization, and file storage. The team is small and the goal is a shippable MVP, not a scalable multi-region system on day one. Longer-term the option to move to a custom Node.js / AWS backend must remain open (see ADR-0004).

Options considered included: (a) roll a Node backend now, (b) Firebase, (c) Supabase, (d) a bare Postgres + hand-rolled auth service.

## Decision

Adopt **hosted Supabase** as the MVP backend, with one Supabase project per environment (dev, staging, prod). Use Supabase for:
- Auth (email/password for MVP).
- Postgres database, accessed via the Supabase client.
- Row-Level Security for authorization (ADR-0003).
- Storage, when file attachments are eventually added.

Access is mediated through the repository layer (ADR-0004) so the choice is reversible.

## Consequences

- **Positive:** Fastest path to a working MVP. Auth, DB, and RLS come as one integrated package. Hosted operations are Supabase's problem, not ours.
- **Positive:** Postgres underneath means no lock-in at the *database* level — schema and data are portable.
- **Negative:** Supabase-specific client patterns (auth helpers, PostgREST idioms) will exist in the repository implementations. This is contained by ADR-0004.
- **Negative:** Multi-region and heavy custom-backend requirements are not first-class in Supabase; we accept this for the MVP.

## Alternatives considered

- **Roll a Node backend now.** Rejected: too much undifferentiated work for an MVP. We can do this later using the swap seam (ADR-0004).
- **Firebase.** Rejected: NoSQL data model is a poor fit for the relational domain (companies -> teams -> boards -> tasks) and conflicts with ADR-0002.
- **Bare Postgres + custom auth.** Rejected: reinvents work Supabase already does well; slows MVP.
