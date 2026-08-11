---
name: Project: Teams Backend Implementation
description: Teams backend complete — types, repository interface, Supabase implementation, service, server actions, hooks, container wiring, and frontend handoff all delivered
type: project
---

Teams module backend is fully implemented as of 2026-08-09. The implementation builds on the approved `supabase/migrations/20260809000001_teams_schema.sql`.

**Why:** Teams module is the second core module after Auth, needed before Employees and Tasks modules.

**Files created:**
- `src/features/teams/types/index.ts` — Team, TeamMember, Board, input DTOs, CreateTeamResult; re-exports AppError/AppErrorCode/ActionResult from auth types
- `src/features/teams/repositories/TeamsRepository.ts` — interface (swap seam per ADR-0004)
- `src/features/teams/repositories/SupabaseTeamsRepository.ts` — Supabase implementation with `server-only` guard; service-role used in delete(), addMember(), removeMember() per DB handoff contract
- `src/lib/errors.ts` — shared normalizeError utility (extracted from auth+teams duplication; both services re-export from here)
- `src/features/teams/services/teamsService.ts` — business logic; validates inputs, enforces authz (defense-in-depth, RLS is authoritative)
- `src/features/teams/services/teamsActions.ts` — 5 Server Actions: createTeamAction, renameTeamAction, deleteTeamAction, addTeamMemberAction, removeTeamMemberAction
- `src/features/teams/hooks/useTeams.ts` — browser read hook + teamsQueryKeys factory (centralized key factory for all 3 hooks)
- `src/features/teams/hooks/useTeam.ts` — browser read hook for single team
- `src/features/teams/hooks/useTeamMembers.ts` — browser read hook for members
- `src/lib/container.ts` — updated to wire SupabaseTeamsRepository + TeamsService
- `docs/handoffs/backend-to-frontend-teams.md` — frontend handoff

**Key contracts:**
- RPC call: `supabase.rpc('create_team_with_board', { p_company_id, p_name })` — NO p_caller_id (C-1 security fix)
- delete() uses service-role with mandatory `.eq('company_id', callerCompanyId)` — callerCompanyId derived from session JWT by service layer, never from client
- addMember() uses service-role + `upsert(..., { onConflict: 'team_id,profile_id', ignoreDuplicates: true })` for idempotency
- removeMember() uses service-role scoped by both team_id AND profile_id
- Error mapping: 23505→CONFLICT, 23514+"Cross-company"→CROSS_COMPANY, 23514+name msgs→VALIDATION_ERROR, 23503→NOT_FOUND, 42501→FORBIDDEN, PGRST116→NOT_FOUND

**Authorization (ADR-0008 — is_platform_admin and role are INDEPENDENT):**
- Admin check: `caller.isPlatformAdmin || caller.role === 'admin'`
- Never require both; platform admin may have role='employee'

**Query keys (ADR-0013):**
- `teamsQueryKeys.all` — `['teams']`
- `teamsQueryKeys.list(callerId)` — `['teams', 'list', callerId]`
- `teamsQueryKeys.detail(teamId)` — `['teams', 'detail', teamId]`
- `teamsQueryKeys.members(teamId)` — `['teams', 'members', teamId]`

**staleTime:** lists=2min, detail=5min, members=1min

**Server Action pattern (H-1 fix applied):**
- `getCallerProfile()` MUST be inside the try/catch in every Server Action
- Pattern: `try { const caller = await getCallerProfile(); if (!caller) return UNAUTHENTICATED; ... } catch (err) { return normalizeError(err) }`
- If `getCallerProfile()` is outside try/catch, `AppError("PROFILE_NOT_FOUND")` becomes a raw 500

**normalizeError shared module:**
- Lives in `src/lib/errors.ts`
- Both `authService.ts` and `teamsService.ts` re-export it from there
- UNKNOWN_ERROR branch uses a fixed generic client-safe message (not `error.message`)
- Original error preserved as AppError cause for server-side inspection
- Future features must import normalizeError from `src/lib/errors.ts` directly or via one of the service re-exports

**memberCount aggregate (added 2026-08-10):**
- `memberCount: number` is required on `Team` (not optional) — populated in both listByCompany and getById to avoid optional-field ambiguity everywhere the type is consumed
- PostgREST embedded aggregate syntax: `.select("..., team_members(count)")` → returns `team_members: [{ count: number | string }]` per row
- PostgREST may return count as string — always coerce: `typeof rawCount === "string" ? parseInt(rawCount, 10) : (rawCount ?? 0)` with `isNaN` fallback to 0
- Same aggregate added to `rename()` return path in SupabaseTeamsRepository (returns Team, must be complete)
- Browser hooks (useTeams, useTeam) also query the aggregate and apply the same coercion — they bypass the server repository layer
- Type cast pattern for Supabase aggregate rows: cast `data` to `unknown` first, then to a local `type TeamsRowWithCount = {...}` to avoid implicit any

**How to apply:** When building Employees or Tasks modules, mirror this exact pattern. The type casting approach (`as unknown as MemberRow`) is needed for Supabase join queries that return arrays for the joined table. For any required aggregate, make it required on the DTO (not optional), populate in all query paths, and apply string-to-number coercion with isNaN guard.
