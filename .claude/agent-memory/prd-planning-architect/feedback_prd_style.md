---
name: PRD Style Preferences — Kanban Project
description: Validated PRD structure and depth conventions for this project
type: feedback
---

Match the tone and structure of /docs/prd/03-employees.md exactly when writing new PRDs for this project. Key conventions confirmed by the existing reference document:

- Numbered FRs: one testable sentence each, no vague "handle errors gracefully"
- Explicit error-copy mapping table (error code → user-visible string)
- Data model in prose only — SQL lives in migrations, never in PRDs
- RLS/auth matrix as a table (operation × role)
- Dedicated open-questions section that surfaces unresolved decisions without choosing on the user's behalf
- Edge cases numbered EC-01, EC-02... with specific scenario names
- Dependencies section listing what must exist before implementation
- Non-goals / out-of-scope section with explicit future-items list
- Business rules section separate from FRs (invariants and ADR references)

**Why:** The project uses a multi-agent model (DB agent, Backend agent, Frontend agent, Reviewer) that reads PRDs as implementation contracts. Vagueness causes inter-agent conflicts. The existing PRD depth sets the contract baseline.

**How to apply:** When drafting any PRD for this project, read 03-employees.md first and match its section structure, heading depth, and FR granularity before writing.
