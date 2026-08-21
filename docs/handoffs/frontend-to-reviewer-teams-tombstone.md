# Teams Tombstone — Frontend to Reviewer Handoff

**Feature:** FE-1 of PRD 05 — Employee Lifecycle & Deletion: Teams frontend tombstone audit  
**Date:** 2026-08-20  
**Prepared by:** Frontend Engineer  
**Migration:** `supabase/migrations/20260819000001_team_members_surrogate_pk.sql`  
**Source contract:** `docs/handoffs/database-to-frontend-teams-tombstone.md`

---

## Overview

Migration `20260819000001` restructures `team_members`: adds a surrogate UUID PK (`id`), makes `profile_id` nullable, and changes the FK to `ON DELETE SET NULL`. When a profile is deleted, the team membership row is preserved with `profile_id = NULL` (a "tombstone") rather than being cascade-deleted.

This frontend update makes the Teams UI defensive-ready for tombstone rows. It must ship in the same release as the migration or any team with a tombstone will render broken.

---

## Completed Work

### 1. Types — `src/features/teams/types/index.ts`

- Added `id: string` field to `TeamMember` interface (surrogate UUID PK).
- Changed `profileId: string` → `profileId: string | null` (nullable after migration).
- Added `RemoveTombstoneInput` interface for the tombstone remove action.

### 2. Repository interface — `src/features/teams/repositories/TeamsRepository.ts`

- Updated `removeMember` JSDoc to explicitly forbid null profileId and explain the footgun.
- Added `removeMemberById(memberRowId: string, teamId: string): Promise<void>` — the only safe way to delete a tombstone row.

### 3. Repository implementation — `src/features/teams/repositories/SupabaseTeamsRepository.ts`

- Added `id` to `rowToTeamMember` input and output.
- Changed `profile_id: string` → `profile_id: string | null` in `rowToTeamMember` and `listMembers` `MemberRow` type.
- Added `id` to the `.select()` string in `listMembers` (`"id, team_id, profile_id, created_at, profiles(display_name, role)"`).
- Updated stale `addMember` comment (composite PK is now a UNIQUE constraint — onConflict still works).
- Added `removeMember` null guard (throws AppError with VALIDATION_ERROR if called with null profileId).
- Implemented `removeMemberById` using `.eq("id", memberRowId).eq("team_id", teamId)` — dual-column guard prevents cross-team deletes.

### 4. Browser hook — `src/features/teams/hooks/useTeamMembers.ts`

- Added `id` to the `.select()` string.
- Updated `MemberRow` type: `profile_id: string | null`, added `id: string`.
- Added `id: row.id` to the mapping.

### 5. Service — `src/features/teams/services/teamsService.ts`

- Updated `removeTeamMember`: added null guard + comment directing callers to `removeTombstone`.
- Added `removeTombstone(teamId, memberRowId, caller)` method: validates UUIDs, authorizes (admin/platform admin), delegates to `repo.removeMemberById`.

### 6. Server Actions — `src/features/teams/services/teamsActions.ts`

- Updated `removeTeamMemberAction`: added early-return null guard at the action boundary.
- Added `removeTombstoneAction(teamId, memberRowId)`: same auth pattern as other actions.

### 7. New hook — `src/features/teams/hooks/useRemoveTombstone.ts`

- New `useRemoveTombstone()` mutation hook.
- Calls `removeTombstoneAction`.
- Invalidates `members`, `lists`, and `detail` query keys on success — same invalidation footprint as `useRemoveTeamMember`.

### 8. Component — `src/features/teams/components/TeamMemberRow.tsx`

- Added `memberRowId: string` prop (replaces the implicit role of `profileId` as React key source and remove target).
- Changed `profileId: string` → `profileId: string | null`.
- Added `onRemoveTombstone: (memberRowId: string) => void` prop.
- **Tombstone rendering path** (when `profileId === null`):
  - Ghost avatar (gray background, user silhouette SVG, no initials).
  - `[Deleted User]` label in italic muted text with `title` tooltip: "This member's account was deleted. Remove this row to clean up."
  - Full row `opacity-60` (muted).
  - No role badge.
  - Admin remove button calls `onRemoveTombstone(memberRowId)`, NOT `onRemove`.
- **Live member rendering path** unchanged except `profileId` is now narrowed to `string` (non-null) within the branch — TypeScript can verify the `onRemove(profileId)` call is safe.

### 9. Component — `src/features/teams/components/TeamMembersList.tsx`

- Imported `useRemoveTombstone`.
- `existingMemberIds`: now filters out tombstone rows (`filter(m => m.profileId !== null)`) before building the Set — tombstones are not live member slots and must not block AddMemberModal from re-adding a profile.
- `removingProfileIds` state renamed to `removingRowIds` (Set<string> keyed by `member.id`, the surrogate UUID).
- `handleRemoveMember`: now accepts `(profileId: string, rowId: string)` — rowId used for pending tracking.
- Added `handleRemoveTombstone(memberRowId: string)`: routes to `removeTombstoneMutation`.
- `remove errors` state remains `Record<string, string>` but now keyed by `rowId` (UUID), not `profileId`.
- `key={member.profileId}` → `key={member.id}` (React key migration — surrogate UUID is always non-null and unique).
- `isRemovePending={removingProfileIds.has(member.profileId)}` → `isRemovePending={removingRowIds.has(member.id)}`.
- Passed `onRemoveTombstone={handleRemoveTombstone}` to `TeamMemberRow`.

---

## Public Interfaces Changed

### `TeamMember` DTO

```typescript
interface TeamMember {
  id: string;               // NEW — surrogate UUID PK from team_members
  teamId: string;
  profileId: string | null; // CHANGED — now nullable (null = tombstone)
  createdAt: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
}
```

### `TeamsRepository`

```typescript
// NEW
removeMemberById(memberRowId: string, teamId: string): Promise<void>;
```

### `teamsActions.ts`

```typescript
// NEW
export async function removeTombstoneAction(
  teamId: string,
  memberRowId: string
): Promise<ActionResult<void>>
```

### `TeamMemberRow` props

```typescript
// CHANGED (added memberRowId, changed profileId to nullable, added onRemoveTombstone)
interface TeamMemberRowProps {
  memberRowId: string;
  profileId: string | null;
  displayName: string | null;
  role: string | null;
  isAdmin: boolean;
  isRemovePending: boolean;
  onRemove: (profileId: string) => void;
  onRemoveTombstone: (memberRowId: string) => void;
}
```

---

## Assumptions

1. `useTeamMembers` query key (`['teams', 'members', teamId]`) is per-team, not per-member. No query key was built from `(teamId, profileId)`. This was confirmed by reading the codebase — the key migration is a no-op at the query level; only the React `key` prop needed changing.
2. NULLS DISTINCT (default PostgreSQL behavior) was chosen in the actual migration SQL (`20260819000001`), overriding the NULLS NOT DISTINCT statement in the handoff text. Each tombstone row is therefore distinct, multiple tombstones per team are allowed, and no "duplicate tombstone" error handling is needed. The task specification confirms this explicitly.
3. Tombstones are never produced by application INSERT — they result from the FK `ON DELETE SET NULL` side effect when a profile is deleted. The guard in `addMember`'s upsert conflict target (`"team_id,profile_id"`) is unaffected.
4. The `search` filter in `TeamMembersList` filters by `displayName`. Tombstone rows have `displayName: null`, so `(null ?? "").toLowerCase()` = `""`. A non-empty search query will exclude tombstone rows from the filtered view. This is acceptable behavior — if the admin needs to find and clean up tombstones, clearing the search shows them all.

---

## Known Limitations

- **Search excludes tombstones when a query is active.** Tombstone `displayName` is null, so they only appear when the search box is empty. This is a minor UX gap. A future enhancement could add an explicit "Show deleted slots" toggle, but that is out of scope for FE-1.
- **Tombstone count not surfaced prominently.** The PRD mentions displaying tombstone count prominently in the admin view. That is a follow-up (FE-3 or a dedicated admin cleanup view) — FE-1 scope is tombstone rendering and removal only.
- **No browser visual test performed.** The app was not spun up for visual verification. The render paths were reasoned through: no null dereference is possible because all null checks are before JSX rendering, and TypeScript confirmed the types are sound.

---

## Breaking Changes

- **`TeamMemberRow` props**: `profileId` is now `string | null`. Any consumer of `TeamMemberRow` outside `TeamMembersList` must be updated to pass `memberRowId` and `onRemoveTombstone`. (No other consumers exist in the current codebase.)
- **`TeamMember.id` is required.** Any code that constructs a `TeamMember` object (e.g., tests, fixtures) must now include `id: string`.
- **`removingProfileIds` renamed to `removingRowIds`** inside `TeamMembersList` — internal state, no external impact.

---

## Deviations From Handoff

None. All FK inventory items were addressed. The NULLS DISTINCT vs NULLS NOT DISTINCT discrepancy between the handoff text and the actual migration SQL was noted and the actual migration was treated as authoritative (consistent with the task specification).

---

## Gaps Discovered in the Handoff

1. **NULLS NOT DISTINCT vs NULLS DISTINCT inconsistency.** The handoff text (line 56: "UNIQUE NULLS NOT DISTINCT") and the coordination notes in the handoff both describe NULLS NOT DISTINCT behavior (one tombstone per team). But the actual migration SQL uses `UNIQUE (team_id, profile_id)` without a `NULLS NOT DISTINCT` clause — which is PostgreSQL's NULLS DISTINCT default (multiple tombstones allowed). The task specification says NULLS DISTINCT was chosen. The handoff text and the rendering contract's "second tombstone rejected" error note should be corrected to match the actual migration.

2. **`removeMemberById` signature in the handoff** shows only `.eq('id', memberRowId)` with no team-scoping guard. The implementation uses `.eq("id", memberRowId).eq("team_id", teamId)` for the dual-column safety guard mentioned in the reviewer notes. The handoff should document the `teamId` parameter.

---

## Next Steps

- **Reviewer**: Audit the changes against the FK inventory. Confirm no other consumers of `TeamMemberRow` or `TeamMember` exist outside the teams feature module.
- **Backend**: No backend changes required by FE-1.
- **FE-3 (deletion UI)**: When the employee deletion actions ship, the tombstone rows will be produced in production for the first time. FE-1's rendering is defensive-ready. FE-3 must handle the `[Deleted User]` count in the employee list view and link to the Teams page for cleanup.
