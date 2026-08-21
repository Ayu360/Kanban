---
name: Teams Tombstone Schema Change (PRD 05 FE-1)
description: team_members now has a surrogate UUID PK and nullable profile_id; FE-1 implemented tombstone rendering and removal
type: project
---

Migration `20260819000001_team_members_surrogate_pk.sql` restructured `team_members`:
- Added surrogate UUID PK column `id` (always non-null, use as React key).
- Made `profile_id` nullable — null rows are tombstones (deleted employee's slot).
- FK changed from `ON DELETE CASCADE` to `ON DELETE SET NULL`.
- UNIQUE constraint `(team_id, profile_id)` uses **NULLS DISTINCT** (default PG behavior) — multiple tombstones per team are allowed.

FE-1 ships defensive rendering before any deletion UI exists (FE-3).

**Why:** When a profile is hard-deleted, team_members rows persist with profile_id = NULL so admins can manually clean up. Without FE-1, tombstone rows would crash `key={member.profileId}` (null React key) and break the remove action.

**How to apply:** Any future feature that reads `TeamMember` must treat `profileId: string | null` — null means tombstone. Use `member.id` (not profileId) as React key. Use `removeTombstoneAction` (not `removeTeamMemberAction`) for null-profileId rows. Never call `removeMember(teamId, null)` — it would match all tombstones in the team.
