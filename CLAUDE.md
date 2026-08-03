# Claude Code Project Instructions

This file contains the shared engineering rules for every Claude subagent working on this project.

Individual agents (Tech Lead, PRD, Database, Backend, Frontend, Reviewer) should only contain role-specific instructions.

Everything below applies to ALL agents.

---

# Project

This project is a production-ready Work Management Platform.

Current stage:

- Single company
- Production application
- Future-ready for multi-company SaaS

Guiding Principle:

> Build for one company. Design for many companies.

Never over-engineer for future SaaS.

Prefer the simplest architecture that does not block future scalability.

---

# Tech Stack

Frontend

- Next.js App Router
- React
- TypeScript
- TailwindCSS
- TanStack Query
- Redux Toolkit

Backend

- Supabase
- PostgreSQL
- Supabase Auth

Deployment

- Vercel

Future migration target

Next.js

↓

Node.js

↓

PostgreSQL

↓

S3

Redis only if justified.

Never recommend MongoDB.

---

# Architecture Principles

Always respect these architectural decisions.

- Feature-first folder structure.
- TanStack Query owns server state.
- Redux owns only UI/client state.
- Business logic stays outside React components.
- Security belongs in the backend/database.
- Repository/Service abstraction should keep frontend loosely coupled from Supabase.
- PostgreSQL is the source of truth.
- Multi-tenancy should be easy to introduce later.
- Avoid tight coupling.

Never introduce architectural changes without justification.

---

# Before Starting Work

Before making any changes:

1. Read the relevant documentation in `/docs`.
2. Understand the feature completely.
3. Identify affected modules.
4. Think before coding.

Do not immediately modify code.

---

# Planning

Every non-trivial task MUST begin with a TODO checklist.

Example:

## TODO

- [ ] Review requirements
- [ ] Identify affected files
- [ ] Implement feature
- [ ] Verify types
- [ ] Test
- [ ] Review

Keep the TODO updated while working.

---

# Communication

Before implementation explain:

- What will change
- Why
- Risks
- Dependencies

Never silently make architectural decisions.

---

# Code Quality

Always prefer

- readable code
- maintainable code
- modular code
- reusable code

Avoid

- duplication
- giant components
- unnecessary abstractions
- premature optimization

---

# TypeScript

Prefer strict typing.

Avoid:

- any
- unnecessary assertions
- duplicated types

---

# React

Prefer:

- composition
- reusable components
- custom hooks
- small components

Avoid:

- business logic inside components
- unnecessary client components
- prop drilling where better solutions exist

---

# Database

Prefer

- normalized schema
- foreign keys
- constraints
- indexes
- RLS

Never sacrifice integrity for convenience.

---

# Security

Never rely solely on frontend authorization.

Assume users can bypass the frontend.

Security belongs in:

- Supabase
- PostgreSQL
- RLS

---

# Performance

Avoid premature optimization.

Optimize only when justified.

When optimization is needed:

1. Explain the bottleneck.
2. Explain why the optimization helps.
3. Describe trade-offs.

---

# Scope Discipline

Stay within your area of responsibility.

If another agent should perform work:

Explain:

- what needs changing
- why
- which agent should handle it

Do not silently modify unrelated areas.

---

# Completion

Every completed task should include:

## Completed

- ...

## Files Changed

- ...

## Risks

- ...

## Suggested Next Steps

- ...

---

# Definition of Done

A task is complete only when:

- Code is clean
- Types pass
- Architecture respected
- Documentation updated if required
- No unnecessary complexity introduced
- Future scalability preserved

---

# Engineering Philosophy

Think like a senior engineer.

Challenge assumptions.

Prefer long-term maintainability over short-term convenience.

Every change should leave the project in a better state than before.
