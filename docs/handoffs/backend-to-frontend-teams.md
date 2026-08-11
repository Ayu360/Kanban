# Teams Backend → Frontend Handoff

**Prepared by:** Backend Agent
**Date:** 2026-08-09
**Status:** READY FOR FRONTEND INTEGRATION
**Branch:** feat/auth-overall-runtime-fixes

---

## Overview

The teams backend layer is complete. This document describes every public surface
the frontend must integrate with: Server Actions, read hooks, query keys, cache
invalidation guidance, and hard constraints the frontend must not violate.

The authentication module (useCurrentUser) is a prerequisite — all teams UI
should only render when a user is authenticated.

---

## Feature Folder

```
src/features/teams/
  types/index.ts           — domain types (Team, TeamMember, DTOs)
  repositories/            — internal (do NOT import in frontend)
  services/teamsActions.ts — Server Actions (the frontend's write API)
  hooks/useTeams.ts        — read hook: team list + query key factory
  hooks/useTeam.ts         — read hook: single team detail
  hooks/useTeamMembers.ts  — read hook: team member list
```

---

## Domain Types

```typescript
// src/features/teams/types/index.ts

interface Team {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface TeamMember {
  teamId: string;
  profileId: string;
  createdAt: string;
  displayName: string | null;
  email: null;  // always null in browser hooks — anon key cannot join auth.users
  role: string | null;
}

interface CreateTeamResult {
  teamId: string;
  boardId: string;
}

// Shared from auth types:
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: AppErrorCode; message: string } };

type AppErrorCode =
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "CROSS_COMPANY"
  | "UNKNOWN_ERROR"
  // ... (see src/features/auth/types/index.ts for full list)
```

---

## Server Actions

All actions are in `src/features/teams/services/teamsActions.ts`.
They are marked `"use server"` — call them from Client Components, form actions,
or TanStack Query mutations.

### createTeamAction

```typescript
import { createTeamAction } from "@/features/teams/services/teamsActions";

const result = await createTeamAction({ companyId: string, name: string });
// result: ActionResult<CreateTeamResult>
// result.data = { teamId: string, boardId: string }
```

**Authorization:** Platform admin OR company admin.
**Errors:**

| code | When | User message hint |
|---|---|---|
| `UNAUTHENTICATED` | No session | Redirect to /login |
| `FORBIDDEN` | Employee, or admin for wrong company | "You do not have permission to create teams." |
| `VALIDATION_ERROR` | Name empty/null/oversized | Use `error.message` directly |
| `CONFLICT` | Duplicate name in company | "A team with this name already exists." |
| `UNKNOWN_ERROR` | Unexpected failure | "Failed to create team. Please try again." |

**Note on companyId:** For company admins, pass `user.companyId` from `useCurrentUser()`.
Do NOT let the user type a companyId — always derive it from the authenticated session.

### renameTeamAction

```typescript
import { renameTeamAction } from "@/features/teams/services/teamsActions";

const result = await renameTeamAction(teamId: string, name: string);
// result: ActionResult<Team>
// result.data = { id, companyId, name, createdAt, updatedAt }
```

**Authorization:** Platform admin OR company admin (for teams within their company).
**Errors:**

| code | When | User message hint |
|---|---|---|
| `UNAUTHENTICATED` | No session | Redirect to /login |
| `FORBIDDEN` | Employee, or admin for wrong company | "You do not have permission to rename this team." |
| `VALIDATION_ERROR` | Name empty/null/oversized | Use `error.message` directly |
| `CONFLICT` | Duplicate name in company | "A team with this name already exists." |
| `NOT_FOUND` | Team doesn't exist | "Team not found." |
| `UNKNOWN_ERROR` | Unexpected failure | "Failed to rename team. Please try again." |

### deleteTeamAction

```typescript
import { deleteTeamAction } from "@/features/teams/services/teamsActions";

const result = await deleteTeamAction(teamId: string);
// result: ActionResult<void>
```

**Authorization:** Platform admin OR company admin.

**CRITICAL:** Do NOT pass companyId as a parameter. The action derives the
correct company scope from the authenticated session server-side. Passing
companyId from the client would be a security regression.

**Errors:**

| code | When | User message hint |
|---|---|---|
| `UNAUTHENTICATED` | No session | Redirect to /login |
| `FORBIDDEN` | Employee caller | "You do not have permission to delete teams." |
| `NOT_FOUND` | Team doesn't exist or cross-company mismatch | "Team not found." |
| `UNKNOWN_ERROR` | Unexpected failure | "Failed to delete team. Please try again." |

**UI requirement:** Show a confirmation dialog before calling this action.
Text must include: "Deleting this team will permanently delete its board and all
tasks. This cannot be undone." (PRD FR-03).

### addTeamMemberAction

```typescript
import { addTeamMemberAction } from "@/features/teams/services/teamsActions";

const result = await addTeamMemberAction(teamId: string, profileId: string);
// result: ActionResult<void>
```

**Authorization:** Platform admin OR company admin.
**Idempotent:** Adding an already-existing member returns success (no error).

**Errors:**

| code | When | User message hint |
|---|---|---|
| `UNAUTHENTICATED` | No session | Redirect to /login |
| `FORBIDDEN` | Employee caller | "You do not have permission to manage team members." |
| `CROSS_COMPANY` | Profile from different company | "Cannot add a member from a different company." |
| `NOT_FOUND` | Team or profile does not exist | "Team or profile not found." |
| `VALIDATION_ERROR` | Invalid UUID format | Use `error.message` |
| `UNKNOWN_ERROR` | Unexpected failure | "Failed to add member. Please try again." |

### removeTeamMemberAction

```typescript
import { removeTeamMemberAction } from "@/features/teams/services/teamsActions";

const result = await removeTeamMemberAction(teamId: string, profileId: string);
// result: ActionResult<void>
```

**Authorization:** Platform admin OR company admin.
**Idempotent:** Removing a non-member returns success (no error).

**Errors:** Same as addTeamMemberAction except CROSS_COMPANY does not apply.

---

## Read Hooks

All hooks are client-side ("use client"). Import them in Client Components.
They use the browser Supabase client + RLS — no server round-trip for reads.

### useTeams

```typescript
import { useTeams } from "@/features/teams/hooks/useTeams";

const { teams, isLoading, error } = useTeams();
// teams: Team[]
// isLoading: boolean
// error: Error | null
```

Returns the teams visible to the current user. RLS filters automatically:
- Employee: only teams they are a member of.
- Company admin: all teams in their company.
- Platform admin: all teams in their company (cross-company is post-MVP).

Requires the user to be authenticated (`useCurrentUser()` must return a user).
If there is no authenticated user, returns `teams: []`.

**Query key:** `['teams', 'list', callerId]`
**staleTime:** 2 minutes

### useTeam

```typescript
import { useTeam } from "@/features/teams/hooks/useTeam";

const { team, isLoading, error } = useTeam(teamId);
// team: Team | null
// isLoading: boolean
// error: Error | null
```

Returns a single team by ID, or null if not found / no RLS access.
Pass `undefined` when teamId is not yet known — the query is disabled until
`teamId` is truthy.

**Query key:** `['teams', 'detail', teamId]`
**staleTime:** 5 minutes

### useTeamMembers

```typescript
import { useTeamMembers } from "@/features/teams/hooks/useTeamMembers";

const { members, isLoading, error } = useTeamMembers(teamId);
// members: TeamMember[]
// isLoading: boolean
// error: Error | null
```

Returns members with `displayName` and `role` from the profiles join.
`email` is always `null` in browser hooks — the anon key cannot join auth.users.

Pass `undefined` when teamId is not yet known — the query is disabled.

**Query key:** `['teams', 'members', teamId]`
**staleTime:** 1 minute

---

## Query Key Factory

The centralized key factory is exported from `useTeams.ts`:

```typescript
import { teamsQueryKeys } from "@/features/teams/hooks/useTeams";

teamsQueryKeys.all                  // ['teams'] — invalidates everything
teamsQueryKeys.lists()              // ['teams', 'list']
teamsQueryKeys.list(callerId)       // ['teams', 'list', callerId]
teamsQueryKeys.details()            // ['teams', 'detail']
teamsQueryKeys.detail(teamId)       // ['teams', 'detail', teamId]
teamsQueryKeys.members(teamId)      // ['teams', 'members', teamId]
```

---

## Cache Invalidation (Mutation Hooks)

When you implement mutation hooks (useCreateTeam, useRenameTeam, etc.), invalidate
these query keys in the `onSuccess` callback:

| Action | Invalidate |
|---|---|
| createTeamAction | `teamsQueryKeys.all` (broad — clears list, detail, members) |
| renameTeamAction | `teamsQueryKeys.detail(teamId)` + `teamsQueryKeys.lists()` |
| deleteTeamAction | `teamsQueryKeys.all` |
| addTeamMemberAction | `teamsQueryKeys.members(teamId)` |
| removeTeamMemberAction | `teamsQueryKeys.members(teamId)` |

Example pattern:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTeamAction } from "@/features/teams/services/teamsActions";
import { teamsQueryKeys } from "@/features/teams/hooks/useTeams";

export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { companyId: string; name: string }) =>
      createTeamAction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamsQueryKeys.all });
    },
  });
}
```

---

## Auth Requirements

All teams routes must be protected by middleware (ADR-0011). The middleware
already redirects unauthenticated users to /login. Do NOT add `useEffect`-based
auth guards in components (ADR-0011).

Admin UI controls (create, rename, delete, add member, remove member) should be
conditionally rendered based on `user.role === 'admin' || user.isPlatformAdmin`
from `useCurrentUser()`. These are UX guards only — the backend enforces
authorization authoritatively.

Employee view: read-only team list and board link. No admin controls visible.

---

## How Mutations Execute (Server-Side Client Strategy)

For reference when debugging or auditing:

| Action | Supabase client used | Why |
|---|---|---|
| `createTeamAction` → RPC | anon key + RLS | RPC validates via `auth.uid()` |
| `renameTeamAction` → UPDATE teams | anon key + RLS | RLS restricts to admin callers |
| `deleteTeamAction` → DELETE teams | **service-role** | Mandatory; company_id filter applied in code |
| `addTeamMemberAction` → UPSERT team_members | **service-role** | DB handoff contract (lines 436-437); service layer is the primary authz guard |
| `removeTeamMemberAction` → DELETE team_members | **service-role** | DB handoff contract (lines 436-437); scoped by team_id AND profile_id |

The frontend never sees or chooses these clients — they are internal to the repository layer.

---

## Client Responsibilities

These are frontend MUST rules. The service layer enforces them server-side, but
violating them at the client layer produces confusing errors rather than clean ones.

- `createTeamAction` accepts a `companyId` parameter. You MUST always pass
  `user.companyId` from `useCurrentUser()`. NEVER derive it from a form field,
  URL parameter, or user input. For company admins the service enforces
  `caller.companyId === input.companyId` and rejects mismatches with FORBIDDEN.
  For platform admins any valid UUID is accepted — but it should still come from
  the authenticated session context, not from an unvalidated client source.

- Never pass any identity claim (`callerId`, `userId`, `role`, `companyId` for
  delete/rename/member actions) to Server Actions. Identity for all authorization
  decisions is derived exclusively from the authenticated session on the server.

---

## MUST-NOT List

- Do NOT import from `src/features/teams/repositories/` directly. That layer is internal.
- Do NOT import from `src/features/teams/services/teamsService.ts` in frontend code. It is server-only.
- Do NOT call `getSupabaseServiceRoleClient()` from any frontend file. Service-role is server-only.
- Do NOT pass `companyId` as a parameter to `deleteTeamAction`. The action derives the correct scope from the session. Passing it would be a security regression.
- Do NOT pass `callerId`, `userId`, or `role` to any Server Action for authorization purposes. All identity is derived from the authenticated session server-side.
- Do NOT implement authorization logic in React components beyond UX gating. The backend (RLS + service layer) is authoritative.
- Do NOT call Supabase mutations directly from components. Use Server Actions for writes.
- Do NOT call Server Actions for reads. Use the provided read hooks (useTeams, useTeam, useTeamMembers).
- Do NOT pass `companyId` from a form field or URL to `createTeamAction`. Always derive it from `useCurrentUser()`. See Client Responsibilities above.

---

## Suggested UI Routes

Per PRD UI Requirements:

| Route | Audience | Content |
|---|---|---|
| `/teams` | All authenticated users | Team list (filtered by role via RLS) |
| `/teams/[teamId]` | All authenticated users with access | Team detail: members list, board link, admin controls |
| `/teams/[teamId]/board` | All authenticated users with access | Board view (future: board module) |

---

## Known Limitations

- `TeamMember.email` is always `null` in browser hooks. To display member emails, a server-side read would be needed (requires service-role or a DB view). Post-MVP enhancement if required.
- `useTeams` queries by the caller's own `companyId`. A platform admin whose profile `company_id` is X will only see teams in company X via `useTeams`, even if they have permission to manage teams in other companies. Cross-company listing is deferred to post-MVP.
- The cascade delete (team → board → columns → tasks) does not yet reach tasks because the tasks table does not exist. When the Tasks module is added, cascade will be automatic via the FK.

---

## Breaking Changes

None — this is the first implementation of the teams module. No existing frontend code depends on these surfaces.
