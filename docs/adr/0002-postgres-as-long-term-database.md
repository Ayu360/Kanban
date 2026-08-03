# ADR 0002: Postgres as the Long-Term Database

**Status:** Accepted — 2026-08-02

## Context

The domain is highly relational: companies contain teams, teams contain boards, boards contain columns, columns contain tasks, tasks are assigned to profiles, profiles belong to companies. Multi-tenancy is enforced by a foreign-key column (`company_id`) that must be reliably present on every business row. Row-Level Security depends on native database enforcement.

The team must decide whether the choice of Postgres (implied by ADR-0001's choice of Supabase) is a temporary convenience or a permanent commitment.

## Decision

**Postgres is the permanent database** for all core business data. This holds regardless of whether the surrounding backend is Supabase or a future custom Node.js service. No NoSQL store (MongoDB, DynamoDB, Firestore, etc.) will be used for core business entities.

NoSQL may be considered later for narrow, well-bounded uses (e.g. a full-text search index, an event log, a cache) but never as the primary system of record for tenants, users, teams, boards, or tasks.

## Consequences

- **Positive:** Referential integrity, transactions, RLS, and mature tooling.
- **Positive:** The migration path in ADR-0004 (Supabase to custom Node) keeps the database and only replaces the API layer — a materially smaller migration.
- **Positive:** Reviewers can reject NoSQL suggestions by reference to this ADR.
- **Negative:** Certain very-high-scale, schema-less workloads would be more ergonomic on NoSQL; we accept this trade-off in exchange for correctness and integrity guarantees.

## Alternatives considered

- **MongoDB / document store.** Rejected: the domain is join-heavy, tenancy enforcement benefits from FKs, and RLS-equivalent tooling is weaker.
- **Mixed store (Postgres + Mongo for some entities).** Rejected: doubles the operational surface and complicates the swap seam.
