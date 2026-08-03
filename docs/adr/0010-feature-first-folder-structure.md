# ADR 0010: Feature-First Folder Structure

**Status:** Accepted — 2026-08-02

## Context

The current codebase mixes cross-cutting folders (`src/api/`, `src/store/`, `src/lib/`) with route folders (`src/app/`). As features grow, the code for a single feature scatters across the tree, making navigation and refactoring painful. A new engineer looking for "everything about tasks" has to check five directories.

## Decision

Adopt a **feature-first** structure. Each feature is a self-contained slice under `src/features/<feature>/`:

```
src/features/<feature>/
  components/     Presentation-only React components
  hooks/          TanStack Query hooks
  services/       Business logic / orchestration
  repositories/   Data access (interface + implementation)
  types/          Feature-local TypeScript types
```

Cross-feature concerns keep dedicated homes:

- `src/components/ui/` — shared presentational components (Button, Modal, Input).
- `src/hooks/` — cross-feature hooks (rare).
- `src/lib/` — infrastructure (Supabase clients, env, logger, composition root).
- `src/store/` — Redux setup and UI slices.
- `src/app/` — Next.js routes; thin, delegates to feature components.

The existing `@ui/*` and `@hooks/*` path aliases in `tsconfig.json` map to these locations even though the folders do not exist yet — they are created as needed.

## Consequences

- **Positive:** All code for a feature lives in one directory. Navigation and refactoring are localized.
- **Positive:** Deleting a feature is deleting a folder.
- **Positive:** Enforces the layering model (ADR-0004) at the folder level — components can't accidentally import repositories from other features.
- **Negative:** Some tension for genuinely cross-cutting utilities. Rule: if two features need it, promote to `src/lib/`, `src/hooks/`, or `src/components/ui/`.
- **Negative:** Routes and features are two different axes. Route files stay under `src/app/` and are kept thin, importing from `src/features/`.

## Alternatives considered

- **Layer-first** (`src/components/`, `src/hooks/`, `src/services/`, ...). Rejected: this is what causes the "code for one feature is scattered" problem. Works at tiny scale, breaks at medium scale.
- **Route-collocated** (all a feature's code under its route folder in `src/app/`). Rejected: mixes routing concerns with domain code, and features that appear on multiple routes have nowhere natural to live.
