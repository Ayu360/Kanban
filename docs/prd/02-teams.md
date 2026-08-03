# Teams — Product Requirements Document

---

# Overview

The Teams module enables company admins and platform admins to create and manage teams within a company, and to control which employees belong to each team. Teams are the organizational unit that owns boards and scopes task visibility. A team is automatically given one default board when it is created. Employees see only the teams they belong to; their board and task access derives from that membership.

This module depends on the Authentication module (01-authentication.md). It should be implemented after Authentication is complete and merged.

---

# Goals

1. Company admins can create, rename, and delete teams within their company.
2. Company admins can add and remove employees from teams.
3. Employees can view the teams they belong to and navigate to their boards.
4. Employees cannot view or access teams they are not members of.
5. Every new team has exactly one board created automatically at creation time, with three seeded columns (Todo, In Progress, Done).
6. Platform admins can perform all team management operations across any company.
7. Team membership changes take effect immediately — database RLS enforces access at query time.

---

# Non Goals

- Per-team roles (e.g., team lead vs. team member) — the `team_members` table has no `role` column in MVP. Post-MVP enhancement.
- Creating teams from the employee's own UI — only admins create teams.
- Self-service team join requests — post-MVP.
- Archiving or soft-deleting teams — deletion is hard delete in MVP.
- Multiple boards per team — one board per team for MVP. Post-MVP.
- Custom column sets per team — columns are seeded and fixed at creation for MVP.
- Team-level notification settings — post-MVP.

---

# User Stories

1. As a company admin, I can create a new team with a name so that I can organize employees around areas of work.
2. As a company admin, I can rename a team so that its name stays accurate as the organization evolves.
3. As a company admin, I can delete a team so that inactive groupings are removed. I understand this also deletes the associated board and all tasks.
4. As a company admin, I can add an employee to a team so that they gain access to that team's board.
5. As a company admin, I can remove an employee from a team so that they lose access to that team's board.
6. As an employee, I can view a list of teams I belong to so that I can navigate to my work.
7. As an employee, I cannot see teams I am not a member of — attempts to access them return no data.
8. As a platform admin, I can perform all of the above operations on any team across any company.

---

# Functional Requirements

## FR-01: Team Creation

- A company admin can create a team by providing a team name.
- Team name is required and must be unique within the company (case-insensitive for uniqueness checking).
- On creation:
  1. A `teams` row is inserted with `company_id` set to the admin's company.
  2. A `boards` row is automatically inserted linked to that team (one board per team).
  3. Three `columns` rows are inserted on the board in a fixed order: "Todo" (position 1), "In Progress" (position 2), "Done" (position 3).
- Steps 1–3 happen as a single atomic operation in one Server Action. The team must not be visible without its board and columns.
- The creating admin is not automatically added to the team as a member — company admins have access to all boards in their company regardless of membership (per ADR-0009).

## FR-02: Team Rename

- A company admin can rename any team in their company.
- The new name must satisfy the same uniqueness and non-empty rules as creation.
- Rename is a simple write. It does not require a Server Action — a client-side Supabase mutation scoped by RLS is sufficient.

## FR-03: Team Deletion

- A company admin can delete a team.
- Before deletion, the UI displays a confirmation dialog that explicitly states: "Deleting this team will permanently delete its board and all tasks. This cannot be undone."
- Deletion is implemented as a Server Action because it requires cascading deletes (team → board → columns → tasks) and must be transactional.
- After deletion, the team, its board, all columns, all tasks within those columns, and all `team_members` rows for that team are removed.
- If the deleted team was the only team an employee belonged to, that employee retains their account and `profiles` row but will see an empty teams list.

## FR-04: Add Employee to Team

- A company admin can add any employee from their company to any team in their company.
- The admin selects an employee from a list of existing company employees.
- Adding an employee inserts a row in `team_members` linking that `profile_id` to the `team_id`.
- This is a privileged write. It is implemented as a Server Action.
- Adding an employee who is already a member of the team is a no-op (the Server Action checks for existing membership before inserting).

## FR-05: Remove Employee from Team

- A company admin can remove an employee from a team.
- Removal deletes the corresponding `team_members` row. The employee's `profiles` row and company membership are unaffected.
- This is a privileged write. It is implemented as a Server Action.
- The employee loses access to the team's board and tasks immediately — RLS enforces this at the database level without any additional cache invalidation on the server.

## FR-06: Employee Team Listing

- An employee (with `role = 'employee'`) sees only the teams they are a member of.
- The teams list page shows team name and a link to the team's board.
- The data is fetched client-side via a TanStack Query hook. RLS automatically filters the result to teams the user has access to — no application-layer filtering is needed.
- A company admin sees all teams in their company in the listing.
- A platform admin sees all teams across all companies (scoped by whichever company context is active in MVP — in practice, all teams for the single default company).

## FR-07: Team Detail / Members View

- Clicking a team (admin view) opens a team detail or management view that lists:
  - The team name (editable inline or via a rename action).
  - The current list of team members (name, email, role).
  - Controls to add or remove members.
  - A link to the team's board.
- Employees who navigate to a team they belong to see the team name, a list of fellow members, and a link to the board. They do not see the add/remove member controls.

---

# Business Rules

- Per ADR-0006, every `teams` row carries `company_id NOT NULL`. An admin can only create teams for their own company. RLS enforces this; the Server Action also validates it explicitly before inserting.
- Per ADR-0009, employees only see boards (and therefore teams) for teams they are a member of. Company admins bypass this filter and see all teams within their `company_id`. Platform admins bypass the `company_id` filter entirely.
- Per ADR-0008, the two admin levels are independent. A platform admin does not need `role = 'admin'` to manage teams — `is_platform_admin = true` alone is sufficient. RLS policy shape: `is_platform_admin OR (company_id = jwt.company_id AND role = 'admin')`.
- One board per team is an invariant in MVP. The `boards` table should carry a unique constraint on `team_id` to enforce this at the database level (described in Database Requirements).
- Board and column creation are an implicit part of team creation — they are not separate user-initiated operations in MVP.
- Deleting a team is irreversible and removes all downstream data. The UI must make this clear before the action executes.
- Per ADR-0015, team creation (with board + column seeding) and team deletion (cascade) are Server Actions. Adding and removing team members are also Server Actions. Simple renames can be client-side Supabase writes.
- Per ADR-0004, the `TeamsRepository` interface is the seam. No Supabase types or query details appear above the repository layer. The service layer orchestrates the multi-step team creation sequence by calling through the repository interface.

---

# Edge Cases

1. **Duplicate team name within a company:** The Server Action checks for an existing team with the same name (case-insensitive) in the company before inserting. If a conflict exists, it returns a user-visible error: "A team with this name already exists."
2. **Deleting a team with active tasks:** The cascade delete removes all tasks. This is intentional and the user is warned. There is no "archive tasks before deletion" flow in MVP.
3. **Removing the last member from a team:** Allowed. The team and its board still exist. The board will be inaccessible to employees but the company admin can still see it.
4. **Adding an employee to a team they are already in:** The Server Action is idempotent. It checks for an existing `team_members` row and returns success without inserting a duplicate.
5. **Renaming a team to the name of another existing team in the same company:** Treated as a duplicate name conflict, same as creation.
6. **An employee is removed from all their teams:** Their account is intact. The teams list page shows an empty state with a message indicating they have no team memberships. They cannot access any boards or tasks.
7. **A company admin tries to manage a team in another company:** RLS rejects the query. The Server Action also validates that the team's `company_id` matches the caller's `company_id` before proceeding. The response is a permission error.
8. **Concurrent team creation with the same name:** The unique constraint on `(company_id, name)` at the database level ensures exactly one creation succeeds. The loser receives a conflict error surfaced back to the user.

---

# UI Requirements

- Teams are listed at a route such as `/teams` (protected; accessible to all authenticated users, filtered by role as described in FR-06).
- The admin view of the teams list includes a "Create team" button that opens a modal or inline form with a single "Team name" field.
- Each team card or row in the admin view shows: team name, member count, a link to the board, and admin actions (rename, delete, manage members).
- The delete action opens a confirmation dialog with the destructive consequence clearly stated before executing.
- The "Manage members" view (or section within the team detail) shows a searchable list of current members and an "Add member" control that opens an employee picker.
- Employee-facing team listing is read-only: team name and a "Go to board" link. No admin controls are shown.
- Loading and empty states are required: a spinner or skeleton while data loads, and a clear empty state when the user belongs to no teams.
- Error states must be shown if the create, rename, or delete Server Action fails (e.g., "Failed to create team. Please try again.").
- All admin controls (create, rename, delete, add member, remove member) are hidden from employees at the UI level. RLS provides enforcement.

---

# Backend Requirements

- `TeamsRepository` interface in `src/features/teams/repositories/TeamsRepository.ts`. Methods include at minimum: `listByCompany`, `getById`, `create`, `rename`, `delete`, `listMembers`, `addMember`, `removeMember`.
- `SupabaseTeamsRepository` in `src/features/teams/repositories/SupabaseTeamsRepository.ts` implements the interface.
- `TeamsService` in `src/features/teams/services/teamsService.ts` orchestrates the multi-step team creation (team insert → board insert → column inserts in one transaction or sequential calls) and validates business rules (name uniqueness, admin authorization).
- Server Actions in `src/features/teams/services/teamsActions.ts` (marked `'use server'`): `createTeamAction`, `deleteTeamAction`, `addTeamMemberAction`, `removeTeamMemberAction`. These are the privileged entry points.
- TanStack Query hooks in `src/features/teams/hooks/`: `useTeams` (list), `useTeam` (single team detail), `useTeamMembers`. Query keys follow the `[feature, entity, scope, params]` convention per ADR-0013: e.g., `['teams', 'list', { companyId }]`, `['teams', 'members', { teamId }]`.
- Cache invalidation: after any team mutation, invalidate `['teams']`. After member add/remove, also invalidate `['teams', 'members', { teamId }]`.
- Per ADR-0004, errors from Supabase (including unique constraint violations) are caught in the repository and normalized to a project error type before surfacing to the service or hook layers.
- Per ADR-0015, the Server Actions use the server-side Supabase client. For operations that need to bypass RLS (e.g., the cascade delete), the service-role key client is used within the Server Action only.
- The composition root (`src/lib/container.ts`) wires `SupabaseTeamsRepository` as the implementation.

---

# Database Requirements

Described in prose only. SQL lives in `supabase/migrations/`.

- A `teams` table holds team records. Each row carries: `id` (UUID, primary key), `company_id` (UUID, non-nullable, foreign key to `companies`), `name` (text, non-nullable), and standard timestamps. A unique constraint applies to `(company_id, name)` to prevent duplicate names within a company.
- A `team_members` join table records team membership. Each row carries: `team_id` (UUID, non-nullable, foreign key to `teams`), `profile_id` (UUID, non-nullable, foreign key to `profiles`), and a `created_at` timestamp. The primary key is the composite `(team_id, profile_id)`.
- A `boards` table holds board records. Each row carries: `id` (UUID, primary key), `team_id` (UUID, non-nullable, foreign key to `teams`), `company_id` (UUID, non-nullable, foreign key to `companies`), `name` (text, non-nullable), and timestamps. A unique constraint on `team_id` enforces one board per team.
- A `columns` table holds column records. Each row carries: `id` (UUID, primary key), `board_id` (UUID, non-nullable, foreign key to `boards`), `company_id` (UUID, non-nullable, foreign key to `companies`), `title` (text, non-nullable), `position` (integer, non-nullable), and timestamps. Per ADR-0006, `company_id` is present on every business table.
- RLS on `teams`: employees see only teams they have a row in `team_members` for. Company admins see all teams with a matching `company_id`. Platform admins see all teams.
- RLS on `team_members`: an employee can read rows where their `profile_id` matches. Company admins can read all rows for teams in their company. Writes (insert/delete) are restricted to company admins and platform admins; employees cannot modify `team_members` directly.
- RLS on `boards`: follows the same three-tier policy as described in ADR-0009 — platform admin bypass, company admin company-scoped bypass, employee team-membership filter.
- RLS on `columns`: inherits the board's team via `board_id`; the policy joins to `boards` to check the `team_id`.
- An index on `team_members(profile_id, team_id)` is required for efficient RLS evaluation. An index on `boards(team_id)` is required for column and task RLS lookups.

---

# Validation Rules

- Team name: required, non-empty after trimming whitespace, maximum 100 characters, unique within the company (case-insensitive).
- Team member addition: the `profile_id` being added must belong to the same `company_id` as the team. A platform admin adding members across companies is a post-MVP scenario and is not handled in MVP.
- Column position: must be a positive integer. The three seeded columns have positions 1, 2, 3. No gaps are introduced at creation time.
- Server Actions validate the caller's role (company admin or platform admin) before executing privileged operations. If the caller is neither, the action returns a permission error.

---

# Acceptance Criteria

1. A company admin creates a team named "Engineering." The teams list immediately shows "Engineering." The board page for "Engineering" is accessible and shows three empty columns: Todo, In Progress, Done.
2. A company admin renames "Engineering" to "Backend." The teams list reflects the new name. Navigating to the board still works.
3. A company admin deletes "Backend." The team no longer appears in the list. Attempting to navigate to the board URL returns an appropriate not-found or permission-denied state.
4. A company admin adds employee Alice to "Engineering." Alice can now see "Engineering" in her teams list and access its board. Before the add, Alice's teams list did not include "Engineering."
5. A company admin removes Alice from "Engineering." Alice's teams list no longer includes "Engineering." Attempting to access the board URL returns no data or a permission-denied state immediately after removal.
6. An employee (non-admin) visits `/teams`. They see only the teams they are members of. No other teams are visible in the response, even if they manually construct a request.
7. Creating two teams with the same name in the same company results in an error on the second creation. The error is shown to the admin in the UI.
8. A platform admin can create, rename, delete teams, and manage members in the default company without holding `role = 'admin'`.

---

# Dependencies

- Authentication module (01-authentication.md) must be complete. `useCurrentUser()` must be available and return the caller's `role` and `is_platform_admin` flag.
- Employees module (03-employees.md) is needed for the "add member" employee picker to list company employees. Teams and Employees are mutually non-blocking for initial implementation, but the member management UI requires the employees data layer to be queryable.
- Database migration creating `teams`, `team_members`, `boards`, and `columns` tables with all RLS policies must be deployed.

---

# Future Enhancements

- Per-team roles (team lead, contributor, viewer) via a `role` column on `team_members`.
- Multiple boards per team, with user-controlled board creation.
- Custom and editable column sets per board.
- Team archiving (soft delete) instead of hard delete.
- Cross-team task views (all tasks assigned to me across all my teams).
- Team-level notification settings.
- Real-time membership update propagation via Supabase Realtime channels exposed through the repository interface.
