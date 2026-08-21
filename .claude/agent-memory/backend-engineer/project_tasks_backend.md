---
name: Project: Tasks Backend Implementation
description: PRD 04 Phase 2 backend complete; types, repo, service, 5 hooks, no container wiring (ADR-0015 client-side writes incompatible with server-only container)
type: project
---

Tasks backend (PRD 04 Phase 2) is complete as of 2026-08-21.

**Why:** Task CRUD is client-side Supabase writes (ADR-0015) — no Server Actions. RLS enforces access. Browser anon key + `getSupabaseBrowserClient()` throughout.

**Key architectural decision:** `SupabaseTasksRepository` and `TasksService` are both `"use client"` because they use `getSupabaseBrowserClient()`. They cannot be wired into `src/lib/container.ts` (which is `"server-only"`). Instead, singletons are exported from `src/features/tasks/hooks/useBoard.ts` and shared by all 5 mutation hooks.

**Assignee validation:** `TasksService.validateAssigneeInDirectory()` queries `employee_directory` view before any write with `assigneeId`. This is the SOLE cross-company guard for assignee until a DB trigger is added. Do not skip this validation path.

**Optimistic move pattern:** `useMoveTask` implements the exact `useMoveTopic` pattern from `src/api/board.ts`: snapshot → targeted patch (only `task.columnId`, no position re-sort) → rollback on error → invalidate on settle. Reviewer R5 compliant.

**Position computation:** In `TasksService`, not the repository. `getMaxPositionInColumn()` is the repository helper method; service calls it before create/move.

**Files created:**
- `src/features/tasks/types/index.ts`
- `src/features/tasks/repositories/TasksRepository.ts`
- `src/features/tasks/repositories/SupabaseTasksRepository.ts`
- `src/features/tasks/services/tasksService.ts`
- `src/features/tasks/hooks/tasksQueryKeys.ts`
- `src/features/tasks/hooks/useBoard.ts`
- `src/features/tasks/hooks/useCreateTask.ts`
- `src/features/tasks/hooks/useUpdateTask.ts`
- `src/features/tasks/hooks/useMoveTask.ts`
- `src/features/tasks/hooks/useDeleteTask.ts`
- `src/features/tasks/hooks/index.ts`
- `docs/handoffs/backend-to-frontend-tasks.md`

**Not done (correct):**
- No container.ts wiring (incompatible — "use client" vs "server-only")
- No Server Actions for task CRUD (ADR-0015)
- fakeApi.ts and src/api/board.ts NOT deleted (Phase 6, frontend agent)
- No column edit hook (out of PRD 04 scope)
