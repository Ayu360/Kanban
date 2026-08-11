---
name: Kanban Platform Architecture
description: Key architectural decisions, conventions, and patterns for the work management platform — essential context for any DB or auth review
type: project
---

Multi-tenant SaaS work management platform (teams, boards, tasks). MVP is single-company but designed for N companies from day one.

**Why:** ADR-0006 mandates `company_id` on every business table from the start to avoid costly multi-tenancy retrofits.

**Key patterns:**
- RLS is the sole authorization enforcement layer (ADR-0003). Frontend checks are UX-only.
- Two-tier admin: `profiles.role` (company-scoped: admin/employee) + `profiles.is_platform_admin` (platform-scoped boolean). Orthogonal. ADR-0008.
- JWT carries `company_id`, `is_platform_admin`, `role` in `app_metadata` via a custom_access_token hook (migration 20260802000002). RLS reads from JWT, not the table.
- First-user-wins bootstrap: if `profiles` is empty on signup, promote to platform admin + company admin. Implemented as a SECURITY DEFINER PL/pgSQL function with an advisory lock. ADR-0014.
- Server Actions for privileged ops (invites, role changes, provisioning). ADR-0015.
- Repository pattern with swap seam (ADR-0004): only repositories touch Supabase; interfaces are feature-scoped.
- Fixed default company UUID: `00000000-0000-0000-0000-000000000001`.

**How to apply:** When reviewing any DB migration, check: company_id present and NOT NULL, RLS enabled with correct platform-admin bypass, JWT claim keys match hook injection (`app_metadata.company_id`, `app_metadata.is_platform_admin`, `app_metadata.role`), SECURITY DEFINER functions have `SET search_path = ''` (empty string, not `public`).

**Teams DB module (migration 20260809000001) — APPROVED (2026-08-09):**
- All 7 prior findings (C-1, H-1, M-1, M-2, M-3, L-1, L-2) confirmed FIXED.
- 2 new Low findings: (1) Missing REVOKE EXECUTE FROM PUBLIC on the 3 trigger functions (defense-in-depth; no actual escalation path since calling them outside trigger context raises immediate errors). (2) p_company_id NULL not validated in RPC — platform admin path would hit a NOT NULL constraint error rather than a clean check_violation.
- Trigger firing order (alphabetical for BEFORE triggers): boards_company_id_match_check fires before boards_updated_at on UPDATE — safe, both pass NEW through cleanly.
- The check_board_company_id_match and check_column_company_id_match triggers fire on ALL UPDATEs (no WHEN clause) — minor perf overhead on board name renames but no correctness issue.
- Backend Agent CLEARED to proceed with SupabaseTeamsRepository and Server Actions.

**Teams Backend module review notes (2026-08-09) — CHANGES REQUIRED (round 1):**
- H-1 (getCallerProfile outside try/catch): RESOLVED in current on-disk state. All 5 Server Actions have getCallerProfile() as the FIRST statement INSIDE the try block (lines 83, 124, 171, 213, 255). PROFILE_NOT_FOUND throws are correctly caught by normalizeError.
- M-1 (addMember/removeMember using anon-key): RESOLVED. Both now use getSupabaseServiceRoleClient() per DB handoff contract (lines 436-437). addMember retains onConflict:"team_id,profile_id" with ignoreDuplicates:true.
- M-2 (normalizeError duplicated): RESOLVED. Canonical implementation at src/lib/errors.ts. authService.ts and teamsService.ts both re-export from @/lib/errors. Old error.message leakage in authService.ts version is gone — new version uses fixed safe string.
- L-1 (raw error.message leakage): PARTIALLY RESOLVED. UNKNOWN_ERROR branch uses safe fixed message. But PG_CHECK_VIOLATION generic fallback at SupabaseTeamsRepository.ts:164 passes raw `message` to AppError. Defense-in-depth: service-layer validateTeamName catches all name cases before DB, so this path only triggers on unforeseen check violations (low practical risk). Dead AppError import in teamsActions.ts (imported but never instantiated — teamsActions delegates entirely to service/normalizeError).

**Teams Frontend module review (2026-08-10) — APPROVED WITH NOTES:**
- tsc --noEmit exits 0. ESLint: 0 errors, 2 pre-existing warnings (img element in KanbanHeader, dead AppError import in teamsActions.ts).
- No test framework in project (pre-existing gap; confirmed no test files anywhere).
- Architecture is clean: TanStack Query for server state, useState for ephemeral modal UI state, no Redux involvement in Teams.
- All 5 mutation hooks call Server Actions only. No direct Supabase writes from any component.
- Read hooks (useTeams, useTeam, useTeamMembers) use browser Supabase client via RLS — correct established pattern.
- Server/client boundary: all pages/components have "use client"; layouts are server components with metadata exports. No server-only imports in client files.
- Middleware protects /teams routes correctly (no /teams in PUBLIC_PATHS).
- Role check `user.role === 'admin' || user.isPlatformAdmin` is correct per ADR-0008 orthogonal admin model.
- companyId for createTeamAction always derives from useCurrentUser — not from URL or form input. Backend contract respected.
- Cache invalidation strategy matches backend handoff table exactly.
- Accessibility: dialogs have role="dialog" aria-modal aria-labelledby. Focus moves to cancel button (ConfirmDialog) or input (form modals). Escape key handled. Body scroll locked. BUT: no Tab key focus trap implemented — keyboard users can Tab outside modals. No focus restoration when modals close (no stored trigger ref). Background content not aria-hidden when modal open.
- Known limitations (acknowledged in handoff): (1) AddMemberModal uses raw UUID input — employee picker pending Employees module. (2) Board link on TeamCard and TeamDetailContent links to /teams/[teamId] (placeholder until Boards module). (3) memberCount: null on TeamCard — N+1 issue at scale.
- Medium findings: (1) Missing Tab key focus trap in all three modals. (2) No focus restoration on modal close. (3) Concurrent member removes cause misleading per-row spinner (removingProfileId only tracks one at a time). (4) PRD requires member count on team cards and searchable member list — not implemented, not acknowledged in handoff as known gap. (5) Brief empty-state flash while useCurrentUser resolves (matches existing project pattern, not unique to Teams).
- Low findings: (1) "Teams" nav link hidden on mobile (sm:block) — on mobile, /teams route is inaccessible from nav. (2) No aria-current on active nav links. (3) boardId prop declared on TeamCard but never passed from TeamsPageContent (dead prop). (4) Persistent delete error banner has no dismiss control.

**Teams Member Count Fix Pass Re-Review (2026-08-10) — APPROVED:**
- tsc --noEmit exits 0. ESLint: 0 errors, 0 warnings on all 7 changed files.
- M-1 (normalization duplication): FULLY RESOLVED. `src/features/teams/utils/aggregates.ts` is pure (no server-only, no Supabase, no React, no env). All 3 call sites (SupabaseTeamsRepository.rowToTeam:79, useTeams.fetchTeams:84, useTeam.fetchTeam:59) delegate to normalizePostgRESTCount. Zero inline coercion remains. Row param widened to `count: number | string` in both repository and hooks.
- M-2 (stale memberCount after member mutations): FULLY RESOLVED. Both useAddTeamMember:38-42 and useRemoveTeamMember:34-38 invalidate exactly 3 keys: members(teamId), lists(), detail(teamId). No over-invalidation (.all not used). Prefix matching verified: lists() returns ["teams","list"] which prefixes ["teams","list",callerId].
- L-1 (TeamCard prop mismatch): FULLY RESOLVED. TeamCard.memberCount: number (line 17). Stale comment removed. Unconditional `<p>` render (line 43). Single caller (TeamsPageContent:267) passes team.memberCount which is Team.memberCount: number — no null can sneak through. All null-check guards removed.
- L-2 (useTeam JOIN comment): FULLY RESOLVED. 4-line comment at useTeam.ts:32-36 precisely explains: DTO contract compliance, detail page doesn't display count, JOIN cost negligible at MVP scale, avoids two-tier type system. Concise and accurate.
- No new findings introduced by this fix pass.
- useCreateTeam and useDeleteTeam correctly use teamsQueryKeys.all for broad invalidation on structural changes (create/delete) — this is appropriate and separate from the scoped member-mutation invalidation.
- Teams module is feature-complete against MVP PRD and approved for merge.

**Teams memberCount review (2026-08-10) — APPROVED WITH NOTES:**
- tsc --noEmit exits 0. ESLint exits 0 on all changed files.
- Team.memberCount: number (required, not optional) — correct. All 4 code paths (rowToTeam, useTeams inline, useTeam inline, TeamsPageContent passthrough) populate it.
- PostgREST embedded aggregate `team_members(count)` used — shape `[{ count: number | string }]`. Number/string coercion + isNaN fallback present in all 3 normalization sites.
- NORMALIZATION DUPLICATION (Medium): rowToTeam in repository + identical inline logic in useTeams + useTeam = 3 copies of the same coerce-and-fallback block. Frontend hooks cannot call rowToTeam (server-only), but the hooks could extract a shared `parseAggregateCount` utility.
- TEAMCARD PROP MISMATCH (Low): TeamCard.memberCount is `number | null` but Team.memberCount is `number`. TypeScript accepts the widening (number satisfies number|null). The `{memberCount !== null && ...}` guard always fires — correct behavior, but the TeamCard interface was not updated to match the new contract. Stale comment on line 11 still says "currently null."
- RLS ANALYSIS — CORRECT: team_members SELECT policy `team_members_select_member` uses EXISTS (SELECT 1 FROM team_members WHERE team_id = current_row.team_id AND profile_id = auth.uid()). An employee who is a member of a team sees ALL membership rows for that team (FR-07 design). This means the embedded count via the employee's anon-key session counts all members they can see — which is all members of their own teams. Count is accurate for employees on their own teams. For teams the employee is NOT a member of, they cannot see the team at all (teams_select_member policy gates top-level team visibility). So there is no "wrong count" scenario: if you can see the team, you can see all its members, and the count is correct.
- MEMBER MUTATION INVALIDATION GAP (Medium): useAddTeamMember and useRemoveTeamMember only invalidate `teamsQueryKeys.members(teamId)`. They do NOT invalidate `teamsQueryKeys.list(callerId)` or `teamsQueryKeys.detail(teamId)`. After adding/removing a member, the memberCount on TeamCard will be stale until the 2-minute staleTime expires.
- Ownership boundary clean: no DB/RLS/migration changes in this pass, no Server Action changes, no mutation hook changes, no auth files.
- No new migrations introduced.

**Teams Backend module fresh review (2026-08-10) — APPROVED WITH NOTES:**
- tsc --noEmit exits 0. No type errors.
- No backend tests exist (entire project has no test files yet).
- Hooks (useTeams, useTeam, useTeamMembers) are frontend-owned — correctly placed in src/features/teams/hooks/, all "use client", use browser Supabase client. No server imports. Cross-team handoff to Frontend.
- Service read methods (listTeamsForCaller, getTeam, listTeamMembers) are defined but currently unused by any caller — defined for future Server Action use.
- Generic PG_CHECK_VIOLATION fallback in mapPostgrestError passes raw error.message as AppError message (Low). Service-layer pre-validation covers all known name check violations so this path is theoretical in current schema.
- Dead AppError import in teamsActions.ts (Low — tsc strict does not flag unused value imports).
- Supabase client usage is clean: server-only in repository (SupabaseTeamsRepository has import "server-only"), browser-only in hooks, container has import "server-only".

**Teams Frontend fix-pass re-review (2026-08-11) — APPROVED WITH NOTES:**
- tsc --noEmit exits 0. ESLint: 0 new errors, 2 pre-existing warnings unchanged (no-img-element in KanbanHeader pre-existed; AppError unused in teamsActions.ts is backend-owned).
- Ownership clean: frontend agent modified only KanbanHeader.tsx, frontend components, and created useFocusTrap.ts + handoff doc. No backend/DB/auth files modified by this pass.
- M-1 (Tab focus trap): RESOLVED. useFocusTrap.ts implements document-level keydown handler with correct Tab/Shift+Tab wrapping. All 3 modals attach containerRef. Handles empty focusable list.
- M-2 (Focus restoration): PARTIALLY RESOLVED — subtle design flaw. ConfirmDialog passes isOpen prop that transitions false on close → restoration fires correctly. TeamFormModal and AddMemberModal use useFocusTrap(true) (conditionally mounted, always-open pattern) → the restore effect has `if (isOpen) return;` which NEVER fires because isOpen is always true. These two modals never restore focus to the trigger button. Keyboard users lose their position.
- M-3 (Concurrent remove): FULLY RESOLVED. Set<string> tracks each in-flight removal independently. New Set(prev).add(id) pattern is immutable. Per-row error clearing on retry confirmed (lines 78-82). Per-row error display via Record<string, string>. isRemovePending wired per-member.
- M-4 (Member count): HANDOFF ONLY. memberCount={null} still passed. Handoff doc is high quality.
- M-5 (Searchable member list): RESOLVED. Local useState, non-mutating filter, toLowerCase both sides, trim on query, label with .sr-only, type="search", distinct empty states.
- L-2 (aria-current): RESOLVED. usePathname() from next/navigation, pathname.startsWith("/teams"), conditional aria-current="page".
- L-3 (dead boardId prop): RESOLVED. Prop absent from TeamCardProps and all call sites.
- L-4 (dismiss button): RESOLVED. Both TeamsPageContent and TeamDetailContent have aria-label="Dismiss error" button with focus ring.
- KEY FINDING: M-2 is only partially fixed. useFocusTrap(true) pattern on conditionally-rendered modals does not trigger focus restoration. Fix: pass isOpen down from the parent as a controlled prop OR use a cleanup return in the mount effect.

**Frontend Auth module review notes (2026-08-09):**
- All prior backend-flagged issues (broken build, missing authSlice imports, legacy getFakeUsers) are RESOLVED. `tsc --noEmit` exits 0.
- Legacy cleanup is complete: authSlice removed from Redux store, no `state.auth` reads, no localStorage auth, no AuthHydration, no `useEffect` auth-guard redirects (ADR-0011 satisfied).
- All auth forms use `useTransition` for pending state, `disabled={isPending}` on submit buttons, `role="alert"` on errors, and correct `autoComplete` hints.
- No direct Supabase auth calls in any client component; all mutations go through Server Actions.
- No server-only imports (supabase/server, env.server, container) in any "use client" file.
- Query invalidation on `authQueryKeys.profile` present after signIn and signUp success; sign-out is form action (no invalidation needed).
- `router.push(result.data.redirectTo)` after login: `redirectTo` value is server-validated by `isSafeRedirectPath()` — open redirect risk is mitigated at the action level.

**Frontend Auth medium-fix follow-up (2026-08-09):**
- M-1 (Suspense boundary for useSearchParams): RESOLVED. `LoginForm` inner component wraps `useSearchParams()`, `LoginPage` default export renders `<Suspense fallback={...}><LoginForm /></Suspense>`. Fallback matches full-screen layout, no layout shift. Both components in same file under single `"use client"` directive — correct per Next.js module boundary rules.
- M-2 (password min-length on confirm page): RESOLVED. `handleSubmit` in confirm/page.tsx runs `password.length < 8` check at line 43 before mismatch check at line 49. Error text exactly matches signup. `aria-describedby` toggles `password-error` / `password-hint`. `role="alert"` on inline error. `updatePasswordAction` not called on early return.
- Open Low findings (Escape key, metadata, unused React import, autoComplete on confirmPassword) remain unresolved — correctly out of scope for this fix.
- NOTE: The `src/app/(auth)/` directory and several other files (`kanban/page.tsx`, `page.tsx`, `KanbanHeader.tsx`, `index.tsx`) are NOT yet committed to git. They exist as untracked/modified working tree changes. The branch `feat/backend-auth-foundation` only has the backend auth commit (f80ad8e). Frontend work needs to be committed.

**Backend Auth module review notes (2026-08-03):**
- `server-only` npm package is NOT installed — `env.ts` exports `SUPABASE_SERVICE_ROLE_KEY` and is imported by `browser.ts` ("use client"). Relies solely on bundler tree-shaking for secret safety. High risk.
- `src/app/login/page.tsx` and `src/features/kanban/components/KanbanHeader.tsx` still import deleted `authSlice.ts` and removed `getFakeUsers`. Broken TypeScript build — ADR-0012 cleanup is incomplete.
- `updatePasswordAction` uses server-side Supabase client for password reset, but no `/auth/callback` route exists for the PKCE code exchange. Password reset flow will fail in production without this route.
- `signUpAction` does not establish a session after signup — the session from `supabase.auth.signUp()` is discarded. User is left unauthenticated after signup if a separate signIn call is not made.
- `mapAuthErrorMessage` relies on string-matching Supabase error messages — fragile, will silently break if Supabase changes message text.
- Middleware uses `process.env.NEXT_PUBLIC_SUPABASE_URL!` with non-null assertion — silent failure if env vars are missing, unlike the startup-fail pattern in `env.ts`.
- `ActionResult<T>` discriminated union pattern is excellent. Swap seam (ADR-0004) correctly implemented.
