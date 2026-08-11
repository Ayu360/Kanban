# Teams Member Count — Frontend → Backend Handoff

**Prepared by:** Frontend Agent
**Date:** 2026-08-10
**Status:** BLOCKING — member count cannot be displayed until backend supplies it
**Related finding:** Reviewer M-4

---

## Problem

The Teams list page (`/teams`) renders a `TeamCard` for each team. The PRD requires
each card to display the number of members in that team. The frontend is currently
passing `memberCount={null}` to every `TeamCard`, so the count is never shown.

---

## PRD Requirement

The team list card must show a member count (e.g. "3 members"). This is a
documented PRD display requirement for the Teams list view.

---

## Current Frontend Behavior

`TeamsPageContent` calls `useTeams()`, which returns `Team[]`. The `Team` type
contains:

```typescript
interface Team {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
```

There is no `memberCount` field. The frontend passes `memberCount={null}` to
`TeamCard`, which conditionally renders the count only when the value is not null.
The count is therefore never rendered.

---

## Why the Frontend Cannot Implement This Correctly

### Option A — N+1 member fetches (rejected)

The frontend could call `useTeamMembers(teamId)` for every team in the list, then
derive the count from `members.length`. This creates N parallel queries for N teams
(N+1 problem), causes waterfall loading on the teams list, and puts unnecessary
read pressure on the database for data that is a simple aggregate.

### Option B — Direct Supabase count query from the browser (rejected)

Calling Supabase directly from the browser for an aggregate would bypass the
established repository abstraction (ADR-0004) and violate the project's ownership
boundary principle (MUST-NOT list in the backend handoff). The frontend must not
import or call repository-layer code.

### Option C — Backend-supplied aggregate (correct)

The count must be computed and returned by the backend as part of the teams list
query. This is a single SQL query with a `COUNT` join or subquery, zero additional
round-trips, and follows the established data-fetching pattern.

---

## Required Backend Response Shape

The backend should augment the `Team` type with an optional `memberCount` field:

```typescript
interface Team {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number; // NEW — count of rows in team_members for this team
}
```

The `memberCount` must be a non-negative integer. A team with no members returns `0`.

### Suggested SQL approach

In the Supabase repository layer, the `listTeams` query can use a left-join count:

```sql
SELECT
  t.*,
  COUNT(tm.profile_id)::int AS member_count
FROM public.teams t
LEFT JOIN public.team_members tm ON tm.team_id = t.id
WHERE t.company_id = $1
GROUP BY t.id
ORDER BY t.created_at DESC;
```

Or as a Supabase PostgREST embedded aggregate (if supported by the current client
version):

```typescript
supabase
  .from("teams")
  .select("*, team_members(count)")
  .eq("company_id", companyId);
```

Either approach is acceptable. The repository normalization layer should map the
result to the `memberCount` field before returning `Team` objects.

---

## Frontend Contract

Once the backend returns `memberCount`:

1. Update `src/features/teams/types/index.ts` — add `memberCount: number` to
   the `Team` interface.
2. Update `src/features/teams/hooks/useTeams.ts` — map the new field through.
3. Update `TeamsPageContent` — pass `memberCount={team.memberCount}` instead of
   `memberCount={null}` to `TeamCard`.

The `TeamCard` component already handles the count rendering correctly — it renders
the count when `memberCount !== null`. No UI changes are needed beyond wiring the
value through.

---

## Blocking / Non-Blocking Status

**BLOCKING for full PRD compliance.** The member count is a PRD-required display
field on the team list card. The feature is functionally usable without it
(teams can be created, renamed, deleted, and navigated to), but the list view is
visually incomplete.

---

## Recommended Backend Action

1. Modify `SupabaseTeamsRepository.listTeams()` to include a member count aggregate.
2. Update the `Team` DTO to include `memberCount: number`.
3. Update `teamsService.listTeams()` if it re-maps the DTO.
4. Confirm the `useTeams` query key invalidation pattern is unchanged.
5. Notify the Frontend Agent when the new field is available so the three wiring
   changes above can be made.

No Server Action signature changes are required — this is a read-path change only.
