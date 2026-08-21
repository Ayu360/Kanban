---
name: Tasks Module DB Layer
description: public.tasks table shape, trigger reuse, consistency trigger pattern, RLS recursion avoidance via is_team_member(), position contract, tombstone-first FK behavior
type: project
---

# Tasks Module — Database Layer (PRD 04, Phase 1)

## Migration

`supabase/migrations/20260820000003_tasks_schema.sql`

## Table: public.tasks

Key columns:
- `id UUID PK DEFAULT gen_random_uuid()`
- `column_id UUID NOT NULL → columns ON DELETE CASCADE`
- `board_id UUID NOT NULL → boards ON DELETE CASCADE` (denormalized for RLS)
- `company_id UUID NOT NULL → companies ON DELETE RESTRICT` (denormalized for RLS)
- `title TEXT NOT NULL` CHECK: `char_length(trim(title)) BETWEEN 1 AND 500`
- `description TEXT NULL` CHECK: `IS NULL OR char_length(description) <= 5000`
- `priority TEXT NOT NULL DEFAULT 'medium'` CHECK: `IN ('low', 'medium', 'high')`
- `assignee_id UUID NULL → profiles ON DELETE SET NULL` (tombstone-first)
- `due_date DATE NULL`
- `position INTEGER NOT NULL` (client-side MAX+1, no uniqueness constraint)
- `created_by UUID NULL → profiles ON DELETE SET NULL` (tombstone-first; write-once in app code)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (trigger-maintained)

## Triggers

- `tasks_updated_at`: reuses `public.handle_updated_at()` from 20260802000001 — no new function.
- `tasks_company_id_match_check`: calls `public.check_task_company_id_match()` SECURITY DEFINER. Validates company_id and board_id match against parent column. UPDATE skip when column_id/company_id/board_id all unchanged.

## RLS

Three-tier (platform admin / company admin / team member) on all four operations.
- Tier-3 uses `public.is_team_member(b.team_id)` via an EXISTS on boards to avoid RLS recursion through team_members.
- INSERT and UPDATE both carry WITH CHECK (Reviewer Y2 requirement).
- DELETE: USING only (no WITH CHECK on DELETE).

## Indexes

- `idx_tasks_board_id` — primary board read path
- `idx_tasks_column_id` — position calculation, column-level invalidation
- `idx_tasks_assignee_id` WHERE NOT NULL — partial, future "my tasks" views
- `idx_tasks_company_id` — company-admin RLS bypass (Reviewer Y2)

## Position contract

No RPC in Phase 1. Backend computes `SELECT MAX(position) FROM tasks WHERE column_id = $1` + 1 before each INSERT or move UPDATE. Concurrent inserts may tie — cosmetic, resolves on onSettled invalidation.

## Tombstone-first

assignee_id and created_by are both ON DELETE SET NULL. Tasks persist when employee is hard-deleted. created_by is write-once at INSERT (from auth.uid()); NULL only from FK action.

## Grants

- `REVOKE ALL FROM PUBLIC; GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`
- Service-role inherits from ALTER DEFAULT PRIVILEGES in 20260818000001 (no explicit grant needed)
