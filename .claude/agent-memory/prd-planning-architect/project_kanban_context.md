---
name: Kanban Platform — Project Context
description: Current state of the Kanban Work Management Platform, shipped modules, and pending work
type: project
---

Production-ready Work Management Platform. Single-company today, designed for future multi-company SaaS.

## Shipped modules (as of 2026-08-18)
- Authentication (01-authentication.md) — profiles, companies, JWT hook
- Teams (02-teams.md) — teams, team_members, boards, columns; RLS and SECURITY DEFINER RPC
- Employees (03-employees.md) — status column on profiles, employee directory view, admin list view, SECURITY DEFINER RPCs for role change, deactivate, reactivate, activate_invited

## In-progress / next
- Tasks (04-tasks.md) — not yet implemented
- Employee Lifecycle Deletion (05-employee-lifecycle-deletion.md) — PRD written 2026-08-18; awaiting user sign-off on 5 open questions before DB agent implementation

## Key invariants already in the DB
- Last-admin lockout enforced in change_employee_role and deactivate_employee RPCs (counts only non-deactivated admins)
- Pending profiles (status='pending') cannot be deactivated via deactivate_employee — must use cancel-invite flow
- team_members.profile_id FK is currently ON DELETE CASCADE — must change to ON DELETE SET NULL for employee deletion tombstone support (open question OQ-03 in PRD-05)
- ALTER DEFAULT PRIVILEGES for service_role is in place (20260818000001) — future tables auto-grant to service_role

## Unresolved decisions blocking PRD-05 implementation
OQ-01: Soft-delete of deactivated profiles — allowed or must reactivate first?
OQ-02: Login access during 24h soft-delete window — revoke immediately or preserve?
OQ-03: team_members PK restructuring — user sign-off needed before FK change
OQ-04: Personal board detection — recommend defer (option c); user must confirm
OQ-05: pg_cron vs lazy check — recommend pg_cron; user must confirm extension availability

**Why:** These decisions affect DB schema constraints and multi-module coordination; wrong choices cannot be easily reversed after migration.
**How to apply:** Do not proceed with DB agent handoff for PRD-05 until user has answered all five OQs.
