# ADR 0004: Repository + Service Abstraction (the Swap Seam)

**Status:** Accepted — 2026-08-02

## Context

ADR-0001 commits us to Supabase for the MVP. The product roadmap explicitly reserves the option to migrate to a custom Node.js / AWS backend later (for reasons like custom business logic, non-standard integrations, or scale patterns Supabase does not serve well). If Supabase-specific patterns leak throughout the frontend, that migration becomes a rewrite instead of a swap.

The current demo has this problem in miniature: `src/api/board.ts` imports `src/lib/fakeApi.ts` directly. There is no seam. Replacing the fake API means editing every hook.

## Decision

Introduce a **repository seam** per feature:

- Each feature (`tasks`, `teams`, `employees`, ...) defines a **repository interface** in `features/<feature>/repositories/` describing the operations that feature needs.
- A **concrete implementation** (initially `SupabaseTasksRepository`) implements that interface.
- **Service functions** in `features/<feature>/services/` contain business rules and depend on the *interface*, not the implementation.
- **TanStack Query hooks** in `features/<feature>/hooks/` depend on services (or, for trivial passthroughs, on the repository interface).
- **Components** depend only on hooks.
- A single **composition root** (`src/lib/container.ts`) wires the concrete implementation. Nothing above the repository layer knows or cares which backend is in use.

Supabase-specific types (e.g. `PostgrestError`) never appear above the repository layer. Errors are normalized to a project-defined error type.

## Consequences

- **Positive:** A future Supabase-to-Node migration touches only the repository implementations and the composition root.
- **Positive:** Enables contract testing: a single test suite validates both the Supabase implementation and any future implementation (ADR in section 15 of PROJECT_CONTEXT).
- **Positive:** Enforces a clean layering that makes the codebase easier to reason about, independent of the migration option.
- **Negative:** Adds an interface layer to every feature. This is the cost we pay to keep the option open. It is small, mechanical work.
- **Negative:** Real-time features (Supabase channels) must be exposed through the interface as abstract subscription methods; can feel awkward.

## Alternatives considered

- **No abstraction; use Supabase client directly in hooks.** Rejected: this is what the current demo does, and it is precisely what makes migration expensive.
- **Full hexagonal architecture with ports and adapters everywhere.** Rejected: over-engineered for the MVP. The repository seam captures 90% of the benefit at 10% of the ceremony.
- **Abstract only at the HTTP boundary (wrap Supabase in a REST API of our own).** Rejected: doubles the code without adding portability — the REST layer itself would still be tightly coupled to Supabase.
