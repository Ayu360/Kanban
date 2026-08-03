# ADR 0015: Server Actions for Privileged Operations

**Status:** Accepted — 2026-08-02

## Context

Not every operation can safely run from the browser with the anon key + RLS. Some operations legitimately need:

- The **service-role key** (to bypass RLS — e.g. provisioning a new company).
- **Server-only secrets** (SMTP credentials to send an invite email).
- **Multi-step transactions** that must not be interruptible by the client (create profile + add to team + send email as one atomic unit).
- **Trusted validation** the client cannot lie about.

At the same time, forcing every mutation through a Server Action would be over-engineered — most operations (create task, move task, edit board) are fine with the client Supabase client + RLS.

## Decision

Two-tier boundary:

**Client-side Supabase (anon key + RLS)** for:
- All reads.
- Simple writes on data the user owns or can access via RLS: create task, edit task, move task, comment on task (when added).

**Server Actions** (Next.js `'use server'`) for:
- Inviting an employee (creates `auth.users` + `profiles` + sends email).
- Changing a user's role or platform-admin flag.
- Provisioning a new company (post-MVP).
- Creating the first user's profile with bootstrap logic (ADR-0014).
- Deleting a board (requires cascade + cleanup).
- Any operation using the service-role key.

Server Actions live under the relevant feature (`features/<feature>/services/*Actions.ts`) and are called by hooks like any other mutation. They validate inputs, authorize the caller against the profile, perform the privileged work, and return typed results or errors.

Route handlers (`app/api/*/route.ts`) are used only for third-party webhooks or when a stable HTTP surface is externally required.

## Consequences

- **Positive:** The service-role key never touches the browser bundle. It exists only in Server Action files, which are guaranteed server-only.
- **Positive:** Everyday mutations stay simple — no Server Action ceremony for creating a task.
- **Positive:** The list of Server Actions is a natural audit surface for "what privileged things can happen?"
- **Negative:** Two mutation styles in the codebase. Requires clear guidelines (this ADR) about which to use.
- **Negative:** Server Actions have different error semantics from client mutations; wrapping in TanStack `useMutation` requires a small adapter. Standard pattern.

## Alternatives considered

- **Everything through Server Actions.** Rejected: ceremonial overhead, worse latency for hot paths (task move), and negates RLS as the client-facing security boundary.
- **Everything client-side, service-role never used.** Rejected: some operations genuinely need to bypass RLS or use server-only secrets. Trying to model these purely in RLS produces baroque policies.
- **Dedicated Node API service.** Rejected for MVP: adds an entire deployment target. Reconsidered as part of the ADR-0004 backend swap if we outgrow Server Actions.
