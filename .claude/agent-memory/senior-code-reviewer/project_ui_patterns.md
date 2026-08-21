---
name: UI/UX Patterns and Conventions
description: Established UI patterns: dark mode input fix, burger menu, modal conventions, search bar gating
type: project
---

Established patterns as of f/ui-fixes batch (2026-08-21):

**Dark mode inputs:** All modal inputs use `dark:bg-slate-700` idle bg. KanbanHeader search uses `dark:bg-slate-800`. Every `focus:bg-white` must be accompanied by a matching `dark:focus:bg-<idle-dark-bg>` on the same className string. The grep baseline is clean — no orphaned `focus:bg-white` without a dark override exists post this batch.

**Burger menu pattern:** Mobile nav (`sm:hidden`) uses fixed-backdrop click-outside dismiss (same pattern as user menu). `aria-expanded` + `aria-haspopup` on toggle, `role="menu"` on panel, `role="menuitem"` on links. Escape key scoped only to burger via conditional early-return guard (`if (!burgerOpen) return`). Burger shows: Teams / Employees (admin-only) / How it works. Does NOT duplicate user menu items (email, logout).

**Modal pattern:** `role="dialog"` + `aria-modal` + `aria-labelledby` on backdrop wrapper. `onClick={onClose}` on backdrop, `stopPropagation` on inner panel. Escape key closes (unless pending). `useFocusTrap` used in TeamFormModal, AddMemberModal, InviteEmployeeModal. Scroll lock via `document.body.style.overflow = "hidden"` on mount.

**Search bar gating:** `showSearch` boolean in KanbanHeader uses `pathname === "/kanban" || /^\/teams\/[^/]+\/board$/.test(pathname)`. Redux `state.ui.searchQuery` is NOT reset when search hides — intentional persistence.

**AppFooter:** Deleted entirely in f/ui-fixes. No consumers remain. `src/components/` directory is now empty. The `body` flex layout in `layout.tsx` still works: `flex min-h-screen flex-col` with single child `min-h-0 flex-1`.

**Why:** Browser testing of PRD 04 revealed these four UX regressions. All frontend-only, no backend changes.

**How to apply:** When adding new inputs to any modal, follow the `dark:bg-slate-700` + `dark:focus:bg-slate-700` pattern. When adding new pages, check whether they should show search (update `showSearch` regex if needed). The `src/components/` directory is intentionally empty — do not add to it without discussion.
