# Teams Module — Tombstone Schema Changes Frontend Handoff

**Migration file:** `supabase/migrations/20260819000001_team_members_surrogate_pk.sql`
**Status:** DATABASE LAYER IMPLEMENTED — FRONTEND INTEGRATION REQUIRED
**Date:** 2026-08-20
**Prepared by:** Database Agent
**PRD:** `docs/prd/05-employee-lifecycle-deletion.md` — FR-15 (Tombstone: Team Memberships), RD-03
**Coordination note (FE-1):** This frontend update MUST ship in the same release as migration 20260819000001. Deploying the migration without the frontend update means tombstone rows (profile_id = NULL) will render as broken member entries and the remove-member action will break.

---

## What Changed in `team_members`

### Before (from `20260809000001_teams_schema.sql`)

```sql
CREATE TABLE public.team_members (
  team_id     uuid NOT NULL,
  profile_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT team_members_pkey PRIMARY KEY (team_id, profile_id),

  CONSTRAINT team_members_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id)
    ON DELETE CASCADE  -- <-- removing a profile deleted the membership row
);
```

### After (from `20260819000001_team_members_surrogate_pk.sql`)

```sql
ALTER TABLE public.team_members
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

-- PK is now the surrogate id column
-- (team_id, profile_id) demoted to UNIQUE constraint (default NULLS DISTINCT)

ALTER TABLE public.team_members
  ALTER COLUMN profile_id DROP NOT NULL;  -- now nullable

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_profile_id_fkey
    FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL;  -- <-- removing a profile now sets profile_id to NULL
```

### Summary of changes

| Aspect | Before | After |
|---|---|---|
| Primary key | Composite `(team_id, profile_id)` | Surrogate `id uuid` |
| `(team_id, profile_id)` role | Primary key | `UNIQUE (team_id, profile_id)` constraint (default NULLS DISTINCT — multiple tombstones per team allowed) |
| `profile_id` nullability | NOT NULL | Nullable |
| FK on delete behavior | CASCADE (row deleted) | SET NULL (row preserved, profile_id becomes NULL) |

---

## FK Inventory — Files Requiring Changes

These files reference `team_id` and `profile_id` together in ways that may break after the schema change:

### `src/features/teams/repositories/SupabaseTeamsRepository.ts`

| Line | Pattern | Change required |
|---|---|---|
| Line 89–90 | `MemberRow` type has `team_id: string; profile_id: string;` — both string, not nullable | Change `profile_id` to `string \| null` |
| Line 100–101 | `rowToTeamMember` maps `row.team_id` and `row.profile_id` to camelCase | No structural change; downstream `TeamMember.profileId` must become nullable |
| Line 376 | `.select("team_id, profile_id, created_at, profiles(display_name, role)")` | Add `id` to the select to use the new surrogate PK as the React key |
| Line 386–387 | `MemberRow` inner type in `listMembers` also has `profile_id: string` (not nullable) | Change to `profile_id: string \| null` |
| Line 407–408 comment | References "DB composite PK (team_id, profile_id) is the conflict target" | Comment is now stale — the conflict target is still `team_id,profile_id` as a UNIQUE constraint, so the upsert still works; update comment |
| Line 412–413 | `.upsert({ team_id: teamId, profile_id: profileId }, { onConflict: "team_id,profile_id", ... })` | **No code change needed.** The UNIQUE constraint on `(team_id, profile_id)` still uses the same column names. PostgREST `onConflict` works with UNIQUE constraints as well as PKs. |
| Line 432–433 | `.eq("team_id", teamId).eq("profile_id", profileId)` in `removeMember` | **No code change needed.** Filtering by these two columns still works correctly for non-tombstone rows. |

### `src/features/teams/hooks/useTeamMembers.ts`

| Line | Pattern | Change required |
|---|---|---|
| Line 37 | `.select("team_id, profile_id, created_at, profiles(display_name, role)")` | Add `id` to the select so each row has the surrogate PK for React keys |
| Line 46–47 | `MemberRow` type: `team_id: string; profile_id: string;` | Change `profile_id` to `string \| null` |
| Line 52–54 | Maps `row.team_id` and `row.profile_id` to `teamId`, `profileId` | Update mapping: `profileId: row.profile_id` (null-safe, see TeamMember type) |

### `src/features/teams/types/index.ts`

| Line | Pattern | Change required |
|---|---|---|
| Line 52 | `TeamMember.profileId: string` | Change to `profileId: string \| null` |

### `src/features/teams/components/TeamMembersList.tsx`

| Line | Pattern | Change required |
|---|---|---|
| Line 41–42 | `existingMemberIds` set: `new Set(members.map((m) => m.profileId))` | Filter out null: `new Set(members.filter(m => m.profileId !== null).map(m => m.profileId!))` — tombstone rows have no profile to exclude from AddMemberModal |
| Line 268–269 | `key={member.profileId}` — using profileId as React key | **Must change.** React keys must be stable and unique. `profileId` can now be `null`. Use the surrogate `member.id` as the React key instead. |
| Line 275 | `removingProfileIds.has(member.profileId)` | Null-safe: `member.profileId !== null && removingProfileIds.has(member.profileId)` |
| Line 276 | `onRemove={handleRemoveMember}` — passes `profileId` to the remove action | Tombstone rows (`profileId = null`) should NOT show a remove button that calls `removeMember(teamId, null)`. See rendering contract below. |

### `src/features/teams/components/TeamMemberRow.tsx`

| Line | Pattern | Change required |
|---|---|---|
| Line 14 | `profileId: string` prop | Change to `profileId: string \| null` |
| Line 32 | `const name = displayName ?? "Unknown member"` | Change to: `const name = displayName ?? (profileId === null ? "[Deleted User]" : "Unknown member")` |
| Line 36–37 | `initials` derived from `name.charAt(0).toUpperCase()` | Works correctly — `"[Deleted User]".charAt(0)` = `"["` — consider using a special tombstone avatar style instead (see rendering contract) |
| Line 56–57 | `{isAdmin && <button ... onClick={() => onRemove(profileId)}>` | **Must guard:** hide the remove button when `profileId === null`. Admins can still remove a tombstone row by clicking a dedicated "Remove tombstone" action, but do NOT call `removeMember(teamId, null)` — that would match all NULL-profile rows for the team. |

### `src/features/teams/hooks/useRemoveTeamMember.ts`

| Pattern | Change required |
|---|---|
| `mutationFn: ({ teamId, profileId })` — always assumes profileId is a non-null string | Guard: if `profileId === null`, this is a tombstone row. Call a different action (e.g., delete by `id` using the surrogate PK via service-role). The current `removeMember(teamId, profileId)` issues `.eq("profile_id", profileId)` which would match ALL tombstone rows for that team if `profileId === null`. Never call this with `profileId = null`. |

---

## Rendering Contract

### Tombstone row definition

A `team_members` row where `profile_id IS NULL` is a tombstone. It represents a deleted employee's membership slot that has been preserved for admin manual cleanup.

### Display rules

| Field | Normal member | Tombstone (profile_id = null) |
|---|---|---|
| Name | `displayName` or `"Unknown member"` | `"[Deleted User]"` |
| Avatar initials | First character of name | Use a distinct "ghost" avatar (e.g., gray background, question mark or X icon) |
| Role badge | Show role from profiles join | Do not show (profiles join returns null) |
| Remove button (admin view) | Show — calls `removeMember(teamId, profileId)` | Show — but must use surrogate `id` to delete, NOT `profileId` |
| Add-member exclusion | Exclude from AddMemberModal (already a member) | Do NOT exclude — tombstone is not a live member slot |

### Recommended tombstone remove action

To remove a tombstone row, use the surrogate `id` column (not `profileId`). The actual implementation uses a **two-column guard** — both `id` and `team_id` — to prevent cross-team deletes even when the call is made under service-role (which bypasses RLS):

```typescript
// Implemented in TeamsRepository interface and SupabaseTeamsRepository
async removeMemberById(memberRowId: string, teamId: string): Promise<void> {
  const serviceClient = getSupabaseServiceRoleClient();
  const { error } = await serviceClient
    .from('team_members')
    .delete()
    .eq('id', memberRowId)      // target the specific surrogate-PK row
    .eq('team_id', teamId);     // cross-team safety: service-role bypasses RLS, so scope explicitly
  if (error) throw mapPostgrestError(error, 'removeMemberById');
}
```

Both filters are required. Omitting `.eq('team_id', teamId)` would leave the delete scoped only by the surrogate UUID (which is globally unique), but the dual-column guard provides defence-in-depth against accidental cross-team deletes under service-role. This is the only safe way to remove a tombstone row without accidentally deleting all tombstone rows for a team.

### Multiple tombstones per team

The unique constraint is `UNIQUE (team_id, profile_id)` with the PostgreSQL default NULLS DISTINCT behavior. Multiple tombstone rows (`profile_id = NULL`) can coexist in the same team — each is treated as distinct. All render as `[Deleted User]`. Admins can clean them up at their own pace with no ordering constraint.

---

## What Did NOT Change

These aspects of the Teams module are unchanged and require no frontend updates:

| Aspect | Status |
|---|---|
| `team_members.team_id` column | Unchanged — still NOT NULL, still FK to teams ON DELETE CASCADE |
| `team_members.created_at` column | Unchanged |
| RLS policies on `team_members` | Unchanged — NULL profile_id rows never match `auth.uid()`, so tombstone rows do not give deleted users access |
| `teams` table | Unchanged |
| `boards` table (select/rename) | `created_by` column added but the read surface for the board page is unchanged |
| RPC `create_team_with_board` | Function signature unchanged. Board creation still works. (Backend agent should update it to write `created_by = auth.uid()` in a follow-up.) |
| Column `idx_team_members_profile_id_team_id` index | Unchanged — still serves the RLS EXISTS subquery efficiently. NULL values are indexed but never matched by `= auth.uid()`, which is correct. |
| GRANT on `team_members` | Unchanged — `authenticated` role still has SELECT, INSERT, DELETE. The new `id` column is covered by the existing SELECT grant. |

---

## React Key Migration

**This is a required breaking change.** Components that use `member.profileId` as a React `key` will crash or produce duplicate-key warnings when `profileId` is null.

Before:
```tsx
{filteredMembers.map((member) => (
  <TeamMemberRow
    key={member.profileId}   // BROKEN: null crashes or non-unique
    ...
  />
))}
```

After:
```tsx
{filteredMembers.map((member) => (
  <TeamMemberRow
    key={member.id}          // CORRECT: surrogate UUID is always unique and non-null
    ...
  />
))}
```

For this to work, the `TeamMember` type must carry the `id` field, and the `listMembers` and `fetchTeamMembers` queries must `SELECT id` alongside the existing columns.

---

## Coordination Note (FE-1)

This migration must ship atomically with the frontend changes. The deployment sequence is:

1. Run `20260819000001_team_members_surrogate_pk.sql` on the database.
2. Deploy frontend changes (React key update, null-safe profile_id rendering, tombstone display).

If the migration is deployed without the frontend changes, any team that has a tombstone row (deleted member) will render broken. The `key={member.profileId}` crash will occur on the next render of that team's member list.

If the frontend changes are deployed before the migration, they are purely additive (null-safe guards are no-ops when all profile_id values are non-null) and safe to ship early.
