# ADR 0009: Team Permissions via `team_members` + RLS

**Status:** Accepted — 2026-08-02

## Context

Boards belong to teams (see PROJECT_CONTEXT section 9). Employees should only see boards for teams they are members of. Company admins should see all boards within their company. Platform admins should see all boards everywhere.

The permission model must be enforceable at the database (per ADR-0003) and cheap to check on every board / task query.

## Decision

- A `team_members` join table records which `profiles` belong to which `teams`.
- RLS policies on `boards`, `columns`, and `tasks` combine three conditions:
  1. **Platform admin bypass:** `is_platform_admin = true` sees everything.
  2. **Company admin bypass:** `role = 'admin' AND boards.company_id = jwt.company_id` sees all boards in their own company.
  3. **Team member filter:** the user is a row in `team_members` for the board's `team_id`.
- The policy shape (pseudocode):
  ```
  is_platform_admin
    OR (company_id = jwt.company_id AND role = 'admin')
    OR EXISTS (
         SELECT 1 FROM team_members
         WHERE profile_id = jwt.sub AND team_id = boards.team_id
       )
  ```
- Column and task policies inherit via the parent board's `team_id`.

## Consequences

- **Positive:** Three concentric permission tiers (platform, company, team) with predictable behavior.
- **Positive:** Adding a user to a team is a single insert; removing them revokes access immediately at the DB layer.
- **Positive:** No application code needed to enforce team scoping — RLS does it.
- **Negative:** RLS policies on `columns` and `tasks` must traverse to `boards` to check team membership. Indexes on `team_members(profile_id, team_id)` and `boards(team_id)` are required. Standard.
- **Negative:** Cross-team dashboards (e.g. "all tasks assigned to me across all teams I'm on") are still fine because the RLS logic naturally scopes to memberships.

## Alternatives considered

- **Role-per-team model** (each user has a role per team). Rejected: too granular for MVP. Can be added later as a `team_members.role` column without changing the base model.
- **Application-layer team check.** Rejected by ADR-0003.
- **Boards owned by users (personal boards).** Rejected in PROJECT_CONTEXT section 9 — every board belongs to a team.
