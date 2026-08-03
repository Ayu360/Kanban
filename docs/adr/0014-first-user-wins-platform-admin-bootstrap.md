# ADR 0014: First-User-Wins Platform Admin Bootstrap

**Status:** Accepted — 2026-08-02

## Context

Once Supabase Auth is live, the system needs a way for the very first user (the founder / operator) to obtain platform-admin privileges. Without a bootstrap mechanism, the first user has no way to invite anyone else, promote themselves, or provision anything — a chicken-and-egg problem.

Common approaches:
- Hard-code an email address as "platform admin."
- Manually flip a database column in the Supabase dashboard after signup.
- Detect an empty `profiles` table on signup and auto-promote the first user.

## Decision

**First-user-wins.** On signup:

1. The Server Action / handler that creates the `profiles` row checks whether `profiles` currently has zero rows.
2. If zero, the new user is created with `is_platform_admin = true` AND `role = 'admin'` (of the default company).
3. If non-zero, the new user is created with `is_platform_admin = false` and default `role = 'employee'`.

The check-and-insert must be atomic (single transaction, or a `SELECT ... FOR UPDATE`, or a unique constraint on "at most one platform admin created via bootstrap" — implementation detail for the migration PR).

## Consequences

- **Positive:** No manual dashboard step. `git clone`, run migrations, sign up — you're the admin. Reproducible for every developer setting up a local env.
- **Positive:** No hard-coded email in code or config.
- **Positive:** In production with an empty database, the first person to sign up is the intended founder — as expected.
- **Negative:** Race condition risk if two users sign up simultaneously into an empty database. Mitigated by transactional check-and-insert.
- **Negative:** If the `profiles` table is ever manually emptied in production, the next signup gets platform-admin. Documented risk; mitigated by never emptying the table.

## Alternatives considered

- **Hard-code an email as platform admin.** Rejected: forces a per-environment code change; leaks a specific person's email into config; painful to change.
- **Manually flip the column via Supabase dashboard.** Rejected: requires a human ceremony every fresh environment; forgettable and error-prone.
- **Provisioning script run out-of-band.** Rejected: same drawback as manual flip, just automated — adds another script to remember.
- **Signup-with-invite-token only, first user gets a bootstrap token.** Rejected: over-engineered for MVP; token distribution is another problem.
