---
name: Kanban project — current architectural state (as of 2026-08-02)
description: Snapshot of the existing Kanban demo before Work Management Platform evolution; used to ground future recommendations.
type: project
---

Kanban repo at `/Users/ayushsingh/Desktop/Personal/Kanban` is a Next.js 16 (App Router) + React 19 + Tailwind 4 demo, deployed on Vercel. It is being evolved into a Work Management Platform, not rewritten.

**Why:** Every architectural recommendation in this repo must respect that the frontend patterns (feature-first, TanStack Query for server state, Redux for UI state, fake API abstraction) already exist and should be preserved, not replaced.

**How to apply:**
- Server-state abstraction currently lives in `src/api/board.ts` (query keys + hooks) backed by `src/lib/fakeApi.ts` (in-memory Map). The fake API is the seam where Supabase repositories will slot in — do not bypass it.
- Redux store lives in `src/store` with two slices: `authSlice` (currentUser + storedUserId, persists to localStorage) and `uiSlice` (searchQuery only). Keep Redux narrow to UI/client state.
- Auth is fake — `AuthHydration.tsx` reads localStorage on mount and rehydrates a user. The `/login` and `/kanban` pages guard client-side only. Real auth (Supabase) will require a Next.js middleware and RSC-safe session reads.
- Kanban feature lives at `src/features/kanban/*`. `index.tsx` is a client component that owns local UI state (editTarget, localTopics, addCardColumnId, moveTargetTopic, isMobile) and orchestrates modals. Components in `components/` are presentation-focused.
- The current data model (`Board`, `Column`, `Topic`) is board-per-user; the new model will replace it with company → teams → employees → tasks. The Kanban board will become a projection over tasks grouped by status, not a first-class entity.
- Locally-added topics use a `local_` prefix and never hit the API — this is technical debt because the "Add card" mutation was never implemented against the fake API; it must become a real create-task mutation.
- Path aliases in `tsconfig.json`: `@/*` → `src/*`, `@features/*`, `@ui/*` (unused — no `src/components/ui` folder yet), `@hooks/*` (unused — no `src/hooks` folder yet).
- `next.config.ts` has React Compiler enabled (`reactCompiler: true`) — memoization is largely automatic; do not over-invest in manual `useMemo`/`React.memo`.
- `AI_CONTEXT.md` at repo root exists (31KB) — check it before duplicating discovery work.
