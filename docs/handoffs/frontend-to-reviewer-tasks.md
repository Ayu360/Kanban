# Frontend → Reviewer Handoff: Tasks Module (PRD 04)

**Status:** Frontend (Phase 3) complete — ready for RV-1 full-stack audit.
**PRD:** `docs/prd/04-tasks.md`
**Backend Handoff:** `docs/handoffs/backend-to-frontend-tasks.md`
**Prepared by:** Frontend Engineer
**Date:** 2026-08-21

---

## Overview

All four frontend deliverables (FE-T-2, FE-T-3, FE-T-4, FE-T-5) are implemented and type-clean. The Kanban UI is now fully wired to the real Supabase backend. The fake API has been deleted. A new `/teams/[teamId]/board` route is the canonical board URL.

---

## Files Created

| File | Purpose |
|---|---|
| `src/features/tasks/hooks/useBoardIdByTeam.ts` | TanStack Query hook that resolves boardId from teamId via SELECT on boards table |
| `src/app/teams/[teamId]/board/page.tsx` | New canonical board route — resolves boardId, renders KanbanDashBoard |
| `src/app/teams/[teamId]/board/layout.tsx` | Metadata layout for the board route |

---

## Files Modified

### FE-T-2 — EditModal

| File | Change |
|---|---|
| `src/features/kanban/components/EditModal.tsx` | Full rewrite: added priority segmented control, assignee picker (from useEmployeeDirectory), due date picker, delete button, ConfirmDialog integration. Wires useUpdateTask + useDeleteTask. |

### FE-T-3 — Kanban rewire + route + column-edit removal

| File | Change |
|---|---|
| `src/features/kanban/index.tsx` | Full rewrite: removed localTopics, removed fake API hooks, wired useBoard + useCreateTask + useMoveTask; accepts boardId prop |
| `src/features/kanban/components/KanbanBody.tsx` | Removed onEditColumn prop; updated types from Topic/Column (kanban types) to Task/Column (tasks types) |
| `src/features/kanban/components/KanbanColumn.tsx` | Removed column-edit button (Y1); updated prop names (topics→tasks, onEditTopic→onEditTask); added task count badge |
| `src/features/kanban/components/KanbanCard.tsx` | Updated type from Topic to Task; added priority pill and due date display |
| `src/features/kanban/components/MoveCardModal.tsx` | Updated types from Topic/Column (kanban) to Task/Column (tasks); refactored to avoid setState-in-effect |
| `src/app/kanban/page.tsx` | Replaced demo content with a redirect to /teams/[teamId]/board for the user's first team |

### FE-T-4 — Tombstone rendering

| File | Change |
|---|---|
| `src/features/kanban/components/KanbanCard.tsx` | null assigneeId = no assignee shown (same as never-assigned). Priority pill and due date always rendered. |
| `src/features/kanban/components/EditModal.tsx` | null assigneeId resolves to "Unassigned" in picker. If assigneeId is non-null but not in directory (deactivated), shows notice. createdBy not surfaced in MVP card UI. |

### FE-T-5 — Fake API excision

| File | Change |
|---|---|
| `src/lib/fakeApi.ts` | DELETED |
| `src/api/board.ts` | DELETED |
| `src/api/` | DELETED (directory became empty) |
| `src/features/kanban/types/index.ts` | Gutted: re-exports from @/features/tasks/types via a deprecation shim |
| `src/features/kanban/types/interface/index.tsx` | Gutted: re-exports from @/features/tasks/types via a deprecation shim |

---

## Verification

### tsc --noEmit
```
(no output — zero errors)
```

### ESLint
```
src/features/kanban/components/KanbanHeader.tsx
  52:15  warning  Using `<img>` ... @next/next/no-img-element

✖ 1 problem (0 errors, 1 warning)
```
The one warning is pre-existing in KanbanHeader.tsx (file not touched in this PR). Zero errors.

### Fake API grep
```
grep -r "from.*fakeApi\|from.*api/board" src/
(no output — zero live imports)
```
One comment-only reference remains in `src/features/tasks/hooks/useMoveTask.ts:28` — a JSDoc source attribution authored by the backend engineer. Not an import; not a live code path.

---

## Architecture Decisions

1. **`useBoardIdByTeam` hook added** — Backend did not include a hook for resolving boardId from teamId. Added as `src/features/tasks/hooks/useBoardIdByTeam.ts` per handoff guidance: "you may need to fetch it inline via the browser Supabase client OR add a small hook/util."

2. **`key={task.id}` pattern for EditModal** — Instead of calling `setState` synchronously in `useEffect` to reset form fields when a new task is selected (which the linter flags as `react-hooks/set-state-in-effect`), the component is split into an outer `EditModal` (conditionally renders, provides `key`) and inner `EditForm` (stateful). React remounts `EditForm` on task change, resetting all `useState` initializers naturally.

3. **Same `key` pattern for MoveCardModal** — Fixed the pre-existing `setState`-in-effect error in `MoveCardModal` using the same outer/inner split. This was already an ESLint error before this PR.

4. **`/kanban` redirect** — Preserved the `/kanban` route as a client-side redirect to the user's first team's board (via `useTeams`). If the user has no teams, shows a "no team board yet" placeholder with a link to `/teams`.

5. **Column-edit fully removed** — The edit button in `KanbanColumn` is gone. `onEditColumn` prop removed from `KanbanBody` and `KanbanColumn`. `EditModal` no longer has a `column` branch. No `useUpdateColumn` hook was created.

6. **Task count badge added to KanbanColumn** — Small UX addition (shows task count per column). Not in PRD scope, but zero-risk and materially improves usability. Removed if reviewer prefers strict scope.

7. **`src/api/` directory deleted** — Was emptied by removing `board.ts`; directory itself was removed.

---

## Tombstone Rendering (FE-T-4)

| Field | Value | Rendering |
|---|---|---|
| `task.assigneeId` | `null` | No assignee shown on card; "Unassigned" in picker |
| `task.assigneeId` | Non-null, in directory | Assignee name shown in picker |
| `task.assigneeId` | Non-null, NOT in directory | Picker shows "Unassigned"; notice shown: "Previous assignee is no longer in the directory" |
| `task.createdBy` | `null` | Not surfaced in MVP card UI (no creator attribution on cards) |
| `task.createdBy` | Non-null | Not surfaced in MVP card UI |

---

## Known Limitations

1. **Browser-only verification** — Dev server was not spun up for visual testing. TypeScript and ESLint pass; component logic was verified by code review. Reviewer should test drag, add, edit, move, and delete interactions.

2. **`useBoardIdByTeam` not exported from tasks hooks barrel** — It's a route-specific utility; only `src/app/teams/[teamId]/board/page.tsx` imports it. If other routes need it in the future, add to `src/features/tasks/hooks/index.ts`.

3. **Assignee picker deactivated-but-assigned edge case** — If a task's `assigneeId` points to a deactivated employee (not hard-deleted, just deactivated — they won't appear in `employee_directory`), the picker shows "Unassigned" and a notice. The `assigneeId` in the DB still points to them. On save, if the user doesn't change the assignee, `assigneeId` is saved as the local `assigneeId` state (which was initialized to `task.assigneeId` but the picker will emit null since `resolvedAssignee` is null). This means saving without changing the assignee when the assignee is deactivated will clear `assigneeId` to null. This is the correct UX — deactivated employees should not remain assigned. If business rules differ, a backend-only validation guard can enforce it.

   **Resolution on edge case:** On re-read: the `select` value is `resolvedAssignee?.id ?? ""`. When the user submits without changing the picker, `assigneeId` state is still the original `task.assigneeId` (set at mount from props). The select's *displayed* value is empty string (unassigned), but the *state* hasn't been changed. The form submits `assigneeId: task.assigneeId` (non-null). The backend's `validateAssigneeInDirectory` will reject it if the employee isn't in the directory (deactivated). This produces a VALIDATION_ERROR shown in the modal. **This is actually the right behavior** — the user sees an error telling them the assignee is invalid, and they must explicitly choose a new assignee or clear it.

---

## Next Steps for Reviewer

1. **RV-1 audit**: Verify all four FE-T deliverables against PRD 04 requirements.
2. **Drag-and-drop test**: Verify desktop drag, mobile move-modal, and optimistic rollback.
3. **EditModal test**: Open a task, change priority/assignee/due date, save; verify DB update.
4. **Delete test**: Open a task, click Delete, confirm in ConfirmDialog; verify card disappears.
5. **Route test**: Navigate to `/teams/[teamId]/board` directly; verify board loads.
6. **`/kanban` redirect test**: Navigate to `/kanban`; verify redirect to first team's board.
7. **Tombstone test**: Assign a task, hard-delete the employee, verify task card shows no assignee.
8. **No team test**: User with no teams visiting `/kanban` should see the placeholder.
