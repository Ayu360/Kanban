# ADR 0012: Retire Redux `authSlice` When Supabase Auth Lands

**Status:** Accepted — 2026-08-02

## Context

The current demo simulates authentication with:

- `src/store/slices/authSlice.ts` — Redux slice holding the current fake user id.
- `src/app/AuthHydration.tsx` — client component that rehydrates the slice from `localStorage` on mount.
- Hard-coded user records inside `src/lib/fakeApi.ts`.

These worked as scaffolding but violate ADR-0005 (no auth or server state in Redux) and ADR-0011 (no client-side session hydration for auth). Keeping them alongside Supabase Auth would produce two sources of truth for "who is the current user."

The team must decide between a **dual-path period** (both systems coexist temporarily) and a **clean cutover** (delete the old the moment the new lands).

## Decision

**Clean cutover in a single PR.** When Supabase Auth is introduced:

1. Add Supabase client factories, middleware, login/signup pages.
2. Replace all reads of "current user" with a `useCurrentUser` hook that reads the session from Supabase + the profile from TanStack Query (`['auth', 'profile']`).
3. Delete `src/store/slices/authSlice.ts`.
4. Delete `src/app/AuthHydration.tsx` and remove it from the root layout.
5. Delete the fake user records from `src/lib/fakeApi.ts` (or delete `fakeApi.ts` entirely if the tasks migration also lands — see PROJECT_CONTEXT section 16).
6. Remove any `localStorage` references related to auth.

No feature flag. No dual-path. No compatibility shim.

## Consequences

- **Positive:** Only one source of truth for "current user" at every point in time.
- **Positive:** Eliminates the class of bugs where the two systems disagree.
- **Positive:** Forces the migration PR to be complete — no half-migrated state left in the tree.
- **Negative:** The PR is bigger and higher-risk than a phased rollout. Mitigated by keeping the change scoped to auth only (tasks migration is separate) and by strong review.
- **Negative:** Requires that Supabase Auth work end-to-end before the PR merges. Reasonable — auth is a foundational feature.

## Alternatives considered

- **Feature flag both systems.** Rejected: doubles the complexity of every auth-touching hook and page during the transition. High risk of subtle drift.
- **Leave `authSlice` in place as a compatibility layer that reads from Supabase.** Rejected: preserves a dead abstraction and violates ADR-0005 indefinitely.
