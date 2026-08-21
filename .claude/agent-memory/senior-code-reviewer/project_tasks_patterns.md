---
name: Tasks Module (PRD 04) Patterns and Findings
description: Architecture decisions, confirmed patterns, and findings from the PRD 04 (Tasks) end-to-end review (RV-1 on 2026-08-21)
type: project
---

Tasks module completed review on 2026-08-21. Verdict: YELLOW — two HIGH issues block commit (assignee display on card, deactivated assignee card indicator).

**Why:** PRD FR-07, UI spec, and AC-5 all require assignee name on the task card. KanbanCard was updated for priority pill and due date but assignee name was never added. The deactivated-with-"Deactivated"-marker requirement (PRD EC-6) is also unmet.

**How to apply:** In future PRD 04 revision reviews, verify KanbanCard renders assignee display name. KanbanCard receives only the Task DTO (has assigneeId UUID but not name) — the fix requires either calling useEmployeeDirectory inside KanbanCard or passing a name map down from the parent.

**Confirmed architectural patterns established in PRD 04:**
- Tasks use module-level singletons (SupabaseTasksRepository + TasksService) in useBoard.ts — container.ts does NOT include tasks (server-only conflict, locked decision)
- Query key factory in tasksQueryKeys.ts: ['tasks', 'list', { boardId }] — all mutations invalidate on onSettled (not onSuccess)
- useMoveTask: outer/inner key remount pattern to avoid setState-in-effect (same for MoveCardModal)
- Direct Supabase browser client in hooks is an established project pattern (useTeams, useTeamMembers, useTeam, useBoardIdByTeam all do it) — not an ADR-0004 violation for client-side hooks
- isOverdue timezone bug: new Date("YYYY-MM-DD") parses as UTC midnight — tasks due TODAY show as overdue in UTC- timezones. formatDate() correctly uses local date constructor but isOverdue does not.
- Deprecation shim in src/features/kanban/types/ has zero active consumers — safe to delete in future cleanup PR
- ConfirmDialog copy drift: EditModal uses "This task will be permanently deleted and cannot be recovered." vs PRD spec "Delete this task? This cannot be undone."
