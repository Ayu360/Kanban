---
name: Project: Employee Lifecycle Backend Implementation
description: PRD 05 Phase 2 backend complete — soft-delete, hard-delete, cancel-invite, resend-invite, undo-deletion, audit log, auth-sweep cron, gap migrations
type: project
---

Employee Lifecycle & Deletion (PRD 05) Phase 2 backend is complete as of 2026-08-20.

**Why:** Extends the Employees module with terminal lifecycle operations (deletion, invite management) and a compliance-grade append-only audit log.

**How to apply:** Future work in the employees feature must respect the audit log pattern (all lifecycle mutations write to employee_lifecycle_log via writeLifecycleLog helper), the ban/unban sequencing contracts (S-2), and the AdminEmployee.deletionScheduledAt field.

## Key files

- `src/features/employees/services/employeesLifecycleLog.ts` — writeLifecycleLog helper + LogWriteError
- `src/features/employees/services/employeesLifecycleActions.ts` — 5 new Server Actions
- `src/app/api/cron/sweep-orphaned-auth/route.ts` — Vercel Cron endpoint
- `vercel.json` — Cron schedule (every 5 min on Pro; daily on Hobby)
- `docs/handoffs/backend-to-frontend-employee-lifecycle.md` — frontend handoff

## Migrations added this sprint

- `supabase/migrations/20260820000001_admin_employee_list_add_deletion_scheduled.sql` — adds deletion_scheduled_at to admin_employee_list view
- `supabase/migrations/20260820000002_create_team_with_board_creator.sql` — updates create_team_with_board to write boards.created_by

## Critical patterns established

1. Server Action = sole authorization gate for lifecycle RPCs (SF-1 reviewer finding)
2. softDelete: RPC → banUser. hardDelete: banUser → RPC → deleteUser.
3. cancelInvite auth failure = SILENT (OQ-3 decision) — orphan swept by cron
4. LogWriteError is caught per-action; log failure never rolls back primary op
5. AdminEmployee.deletionScheduledAt (non-null = in grace window, status still 'active')
6. Auth-sweep grace window = 10 minutes (R-NEW-1 race protection)
7. CRON_SECRET env var must be set in Vercel for sweep endpoint to function
