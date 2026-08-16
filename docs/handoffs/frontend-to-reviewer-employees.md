# Frontend → Reviewer Handoff: Employees Module

**Status:** Frontend implementation complete — ready for code review.
**Branch:** `f/foundation-employees-module`
**Prepared by:** Frontend Engineer

---

## Overview

The Employees module frontend is fully implemented against the backend contract in `docs/handoffs/backend-to-frontend-employees.md`. This document describes every file created or modified, behavioral decisions made, and items for the reviewer to verify.

---

## Files Created

### Feature components (`src/features/employees/components/`)

| File | Responsibility |
|------|----------------|
| `EmployeesPageContent.tsx` | Main client orchestrator — `useEmployees`, mutations, search/filter state, modal/dialog state, dismissible error banners, loading/error/empty states |
| `EmployeeCard.tsx` | Single row: name/email fallback, role badge, status badge, conditional action buttons (promote/demote/deactivate/reactivate) |
| `InviteEmployeeModal.tsx` | Email invite modal with client-side format validation, `useInviteEmployee`, CONFLICT handling, focus trap |
| `EmployeeConfirmDialog.tsx` | Reusable confirm dialog with `variant='default'` (role change) and `variant='destructive'` (deactivation) |

### Routes

| File | Responsibility |
|------|----------------|
| `src/app/employees/layout.tsx` | Server Component layout with metadata |
| `src/app/employees/page.tsx` | `"use client"` — wraps `KanbanHeader` + `EmployeesPageContent` (mirrors Teams page pattern) |
| `src/app/accept-invite/layout.tsx` | Server Component layout with metadata |
| `src/app/accept-invite/page.tsx` | `"use client"` — calls `useActivateInvitedEmployee` on mount, handles success/deactivated/generic-error states with retry |

---

## Files Modified

| File | Change |
|------|--------|
| `src/app/login/page.tsx` | Added `?error=deactivated` and `?error=pending` banner in `LoginForm` (reads existing `useSearchParams`). Unrecognized values show no message. Banner uses `role="alert"` + `aria-live="polite"`. Styled amber to differentiate from form submit errors (red). |
| `src/features/kanban/components/KanbanHeader.tsx` | Added "Employees" nav link after "Teams". Admin-only (`user.role === 'admin' \|\| user.isPlatformAdmin`). `aria-current={isEmployeesActive ? "page" : undefined}`. |
| `src/features/teams/components/AddMemberModal.tsx` | Full upgrade from raw UUID input to employee picker. Consumes `useEmployeeDirectory()`. Applies `employees.filter(e => e.displayName !== null)` to exclude pending employees. Preserves all existing accessibility patterns (focus trap, ARIA, escape key). |

---

## Behavioral Contracts Honored

- **`useFocusTrap`** is imported from `@/features/teams/hooks/useFocusTrap` (reused, not re-implemented) by all three modals.
- **Per-employee in-flight Sets** (`pendingRoleIds`, `pendingStatusIds`) follow the Teams `Set<string>` + `new Set(prev).add()` pattern for concurrent action isolation.
- **Dismissible error banners** match the Teams pattern exactly — `role="alert"`, `aria-label="Dismiss error"` on close button, shown for role-change and status-change errors separately.
- **UNKNOWN_ERROR** on partial deactivation (M-2 in handoff) is surfaced verbatim — not swallowed.
- **FORBIDDEN** on role change (last-admin lockout) is surfaced via the banner.
- **`/accept-invite`** `useEffect` dependency array is intentionally `[]` (run once on mount); documented with an `eslint-disable` comment.
- **Middleware** `/accept-invite` path confirmed in `PENDING_ALLOWED_PATHS` (line 85 of `src/middleware.ts`) — no modification made.
- **Pending employee rows**: no role-change or deactivation controls shown (PRD UI Requirements). Only reactivation is also absent (pending ≠ deactivated).
- **Self-row**: `isSelf` prop derived from `emp.id === user?.id` — hides promote/demote/deactivate on the caller's own row.
- **`displayName` null fallback**: `employee.displayName ?? employee.email ?? 'Unknown'` in `EmployeeCard`.
- **Directory picker filter**: `employees.filter(e => e.displayName !== null)` applied in `AddMemberModal` before search.
- **Empty state message**: "No employees yet. Invite someone to get started." (PRD spec).

---

## Assumptions

1. The `/employees` page uses `"use client"` at the page level (same as Teams `/teams/page.tsx`) rather than a Server Component shell. This is because `KanbanHeader` is already a client component and there is no server-side data fetching required at the page wrapper level.
2. The deactivation confirm dialog body text says "They will immediately lose the ability to log in" — this matches PRD intent. The PRD's "prominent" wording is interpreted as: destructive red button + explicit login-access explanation.
3. Login error banner is styled amber (not red) to distinguish middleware-injected status errors from auth-submission errors. Both are `role="alert"`.
4. The `accept-invite` page retry flow re-calls `activate.mutate` inline (not via a separate handler ref) to keep the component simple. If the mutation is idempotent (backend handoff confirms it is), this is safe.

---

## Deviations from Handoff

None. All handoff requirements are implemented as specified.

---

## Cross-team Handoff Docs

None required. No backend or database changes are needed.

---

## Accessibility Checklist

- [x] All modals: `role="dialog"` `aria-modal="true"` `aria-labelledby`
- [x] All modals: `useFocusTrap` — initial focus, Tab/Shift+Tab cycle, trigger restore
- [x] All modals: `aria-describedby` on error messages (`aria-invalid` + `aria-describedby` on inputs)
- [x] Search inputs: `<label htmlFor className="sr-only">`
- [x] Error banners: `role="alert"` + dismiss button with `aria-label="Dismiss error"`
- [x] Status/async errors: `role="alert"` or `aria-live`
- [x] Nav link: `aria-current` on active route
- [x] Employee picker listbox: `role="listbox"` + `role="option"` + `aria-selected`
- [x] Status badges: purely visual — no semantic meaning hidden from AT (text content is explicit)

---

## Responsive Behavior

- Employee card: stacks vertically on mobile (`flex-col`), row on `sm:` (`sm:flex-row sm:items-center`)
- Action buttons: wrap on narrow viewports (`flex-wrap`)
- Employee picker listbox: `max-h-48` with `overflow-y-auto`

---

## Known Limitations (inherited from backend)

1. No invite revocation in MVP — pending rows show indefinitely.
2. JWT staleness after deactivation — user may remain logged in up to 1 hour.
3. Role change not immediately visible to the affected user — they must re-login.

---

## TypeScript

`npx tsc --noEmit` passes with zero errors after all changes.

---

## Suggested Next Steps

1. Reviewer to verify accessibility in a real browser (keyboard nav, screen reader with VoiceOver/NVDA).
2. Product to clarify whether pending employees should show a "Resend invite" action (post-MVP per PRD but worth confirming).
3. Consider promoting `EmployeeConfirmDialog` to a shared `src/components/ConfirmDialog` with a `variant` prop — it now serves both Teams (destructive-only) and Employees (default + destructive). This is a refactor for a future PR.
