# Frontend → Reviewer Handoff: Employee Lifecycle & Deletion UI (PRD 05 Phase 3)

**Status:** Frontend implementation complete — ready for full-stack reviewer audit (RV-1).
**PRD:** `docs/prd/05-employee-lifecycle-deletion.md`
**Prepared by:** Frontend Engineer
**Date:** 2026-08-20

---

## Overview

This handoff covers the Phase 3 (frontend) implementation of PRD 05 — FE-2 (mutation hooks), FE-3 (row actions, confirmation dialogs, status badge), and FE-4 (grace-window polling). All three deliverables were implemented in a single session.

---

## Completed Work

### FE-2: Five mutation hooks

| File | Description |
|---|---|
| `src/features/employees/hooks/useSoftDeleteEmployee.ts` | Mutation hook for `softDeleteEmployeeAction`. Unconditional invalidation of lists, detail, and directory on success. |
| `src/features/employees/hooks/useHardDeleteEmployee.ts` | Mutation hook for `hardDeleteEmployeeAction`. Same invalidation pattern. |
| `src/features/employees/hooks/useUndoScheduledDeletion.ts` | Mutation hook for `undoScheduledDeletionAction`. Handles three outcomes: success, race-case (already_deleted), and error. |
| `src/features/employees/hooks/useCancelInvite.ts` | Mutation hook for `cancelInviteAction`. Invalidates lists only (pending employees not in directory). |
| `src/features/employees/hooks/useResendInvite.ts` | Mutation hook for `resendInviteAction`. No cache invalidation (profile row unchanged). |

### FE-3: Row actions, confirmation dialogs, status badge

| File | Description |
|---|---|
| `src/features/employees/components/EmployeeCard.tsx` | Added `deletion-scheduled` badge variant (amber-100/amber-800), `hasOtherAdmin` prop, and five new action handlers. Deletion Scheduled badge takes precedence over Active. Tooltip via `title` attribute showing local-timezone formatted deletion time. |
| `src/features/employees/components/EmployeesPageContent.tsx` | Added `DismissibleErrorBanner` module-level component; added `deletionTarget`/`deletionAction`/`deletionError` state; added `hasOtherAdmin` quorum memo; added all five new handlers; added deletion-family dialog config via `useMemo`; wired `EmployeeConfirmDialog` for all five new dialogs. |

### FE-4: Grace-window polling

| File | Description |
|---|---|
| `src/features/employees/hooks/useEmployees.ts` | Added `refetchInterval` using TanStack Query v5 `query`-argument form. Polls at 30 seconds when any row has `deletionScheduledAt !== null`; disabled otherwise. |

---

## Public Interfaces

### EmployeeCard props (new/changed)

```typescript
interface EmployeeCardProps {
  // ... existing props unchanged ...
  hasOtherAdmin: boolean;            // NEW — quorum check result from parent
  onScheduleDeletion: (employee: AdminEmployee) => void;  // NEW
  onDeleteNow: (employee: AdminEmployee) => void;         // NEW
  onCancelScheduledDeletion: (employee: AdminEmployee) => void; // NEW
  onCancelInvite: (employee: AdminEmployee) => void;      // NEW
  onResendInvite: (employee: AdminEmployee) => void;      // NEW
}
```

### New hooks (all in `src/features/employees/hooks/`)

```typescript
// Returns MutationResult<ActionResult<SoftDeleteResult>, Error, string>
function useSoftDeleteEmployee(): ...

// Returns MutationResult<ActionResult<HardDeleteResult>, Error, string>
function useHardDeleteEmployee(): ...

// Returns MutationResult<ActionResult<UndoScheduledDeletionResult>, Error, string>
function useUndoScheduledDeletion(): ...

// Returns MutationResult<ActionResult<CancelInviteResult>, Error, string>
function useCancelInvite(): ...

// Returns MutationResult<ActionResult<ResendInviteResult>, Error, { targetProfileId: string; email: string }>
function useResendInvite(): ...
```

---

## Assumptions

1. Backend implementation in `employeesLifecycleActions.ts` and all referenced RPCs are complete and deployed with the required migrations (20260819000002, 20260820000001).
2. `AdminEmployee.deletionScheduledAt` is correctly populated by the `admin_employee_list` view and returned by `listEmployeesAction`.
3. The `deactivateMutation.isPending` check at the `EmployeeCard` level is appropriate — the card only dims buttons when its own employee ID is in `pendingStatusIds`. The pending-Set isolation ensures concurrent actions on different rows work correctly.

---

## Known Limitations / Deferred Items

1. **Invalidation-on-failure pattern inconsistency** — the new hooks use unconditional invalidation in `onSuccess` (FE-1 pattern), while the older hooks (`useDeactivateEmployee`, `useReactivateEmployee`, `useInviteEmployee`) use conditional invalidation. Deferred per task instructions; flagged in hook JSDoc.

2. **Tooltip accessibility** — the "Deletion Scheduled" badge uses the `title` attribute for the tooltip (consistent with existing badge tooltips). A proper ARIA tooltip component is a follow-up deferred per task instructions.

3. **`isStatusPending` covers all deletion-family actions** — `EmployeeCard` receives `isStatusPending` from the parent for grace-window (cancel-scheduled-deletion), cancel-invite, and resend-invite buttons. The parent tracks these via `pendingDeletionIds` but passes them as `isStatusPending`. A future cleanup could split this into separate props.

4. **`EmployeesPageContent` component size** — the file is now ~720 lines. The component remains within acceptable complexity for a page-level orchestrator, but a future refactor into smaller sub-components (e.g., `EmployeeDeletionDialogs`) would be warranted once more dialogs are added.

---

## Breaking Changes

- `EmployeeCard` has five new required props. Any test or storybook rendering `EmployeeCard` directly will fail to compile until the new props are provided.

---

## Verification Results

- `npx tsc --noEmit` — clean (no output).
- `npx eslint <changed files>` — clean (no output).
- Browser verification: not performed in this session (no dev server access). Reviewer should verify in a browser.

---

## Next Steps

1. **Reviewer (RV-1):** full-stack audit — verify action menu items render correctly per status, dialogs open with correct copy, badge appears for grace-window employees, polling activates/deactivates correctly.
2. **Deploy:** apply migrations in correct order, set `CRON_SECRET` in Vercel, enable pg_cron in Supabase Dashboard.
3. **Future:** audit log UI, tooltip a11y improvement, invalidation-on-failure pattern cleanup across all employee hooks.
