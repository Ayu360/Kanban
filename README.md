# Work Management Platform

A production-ready, team-based work management application. Companies organise into teams, teams own Kanban boards, boards contain columns of tasks, and tasks are assigned to employees. Built for one company today, architected for many companies tomorrow.

Originally a Kanban demo; now a full multi-feature platform with Supabase Auth, Postgres + RLS, employee lifecycle management, and multi-team navigation.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Server Components, Server Actions) |
| UI | React 19, Tailwind CSS 4, `lucide-react`, `framer-motion` |
| Client state | Redux Toolkit (UI-state only) |
| Server state | TanStack Query 5 |
| Drag and drop | `@dnd-kit/core`, `@dnd-kit/sortable` |
| Backend | Supabase — Postgres, Auth, Row Level Security |
| Auth transport | `@supabase/ssr` (HTTP-only cookies) |
| Language | TypeScript (strict) |
| Deployment | Vercel |

---

## Features

### Authentication
- Email + password signup and login via Supabase Auth
- Password reset (PKCE flow)
- Invite acceptance for employees added by an admin (implicit hash flow)
- Session enforcement in Next.js middleware — no flash of protected content, JS-disabled clients cannot bypass auth
- Status-claim gating: `deactivated` users are signed out; `pending` invitees only reach `/accept-invite`

### Teams
- Create, rename, and delete teams
- Add and remove team members
- Team switcher in the app header for multi-team users
- "Last visited team" is remembered and restored after login
- Soft-delete + tombstone with an undo window

### Employees (admin surface)
- Invite by email (Supabase `inviteUserByEmail`)
- Cancel or resend a pending invite
- Change role between `admin` and `employee`
- Deactivate / reactivate (JWT-aware — writes `status` to `app_metadata` via the custom access token hook)
- Soft-delete with a scheduled hard-delete window and an undo action
- Hard-delete (immediate, service-role)
- Lifecycle log capturing every state transition
- Nightly cron sweep for orphaned `auth.users` rows

### Kanban Board
- Data-driven columns (Todo, In Progress, Done — extensible)
- Drag-and-drop tasks between columns with optimistic updates
- Create, edit, and delete tasks
- Assign tasks to team members

### Multi-tenancy readiness
- Every business table carries `company_id NOT NULL` from day one
- All RLS policies filter by `company_id` and, for team-scoped tables, by team membership
- MVP seeds a single "default" company; adding tenants later is a data-load exercise, not a schema rewrite
- Two-tier admin: `profiles.role = 'admin'` (company admin) and `profiles.is_platform_admin = true` (platform superuser, RLS bypass)

---

## Getting Started

### Prerequisites

- Node.js 18+ (see `.nvmrc`)
- A Supabase project (free tier is fine for development)
- Vercel account (only required for deployment)

### Setup

```bash
# 1. Install dependencies
yarn install

# 2. Configure environment
cp .env.example .env.local
# then fill in your Supabase project URL and keys

# 3. Apply database migrations to your Supabase project
#    (via Supabase CLI or the SQL editor — see supabase/migrations/)

# 4. Start the dev server
yarn debug
```

Open [http://localhost:3000](http://localhost:3000). The first user to sign up is automatically promoted to platform admin (first-user-wins bootstrap — see ADR-0014).

### Environment variables

| Name | Scope | Purpose |
|------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Public anon key, RLS-respecting |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | RLS bypass; used only in privileged Server Actions |
| `NEXT_PUBLIC_APP_URL` | Browser + server | Base URL for auth email redirects |

### Scripts

| Script | Description |
|--------|-------------|
| `yarn debug` | Start Next.js dev server |
| `yarn build` | Production build |
| `yarn start` | Run production server |
| `yarn lint` | ESLint |

---

## Routes

| Path | Auth | Description |
|------|------|-------------|
| `/` | Public | Landing page |
| `/login` | Public | Email + password login |
| `/signup` | Public | Signup (first user becomes platform admin) |
| `/reset-password` | Public | Request a password reset email |
| `/reset-password/confirm` | Public | Set a new password after clicking the email link |
| `/accept-invite` | Public | Invitee completes account setup |
| `/how-it-works` | Public | Product walkthrough |
| `/kanban` | Protected | Default post-login board |
| `/teams` | Protected | List of teams the user can access |
| `/teams/[teamId]` | Protected | Team detail (members, settings) |
| `/teams/[teamId]/board` | Protected | Team's Kanban board |
| `/employees` | Admin only | Employee admin surface |
| `/api/auth/callback` | Public | PKCE callback for password reset |
| `/api/cron/sweep-orphaned-auth` | Cron only | Nightly cleanup of orphaned auth rows |

---

## Architecture

Six-layer feature-first architecture. Each layer depends only on layers below it.

```
UI (React components)
   ↓
UI State (Redux slices — modals, filters, drag preview)
   ↓
Server State (TanStack Query hooks)
   ↓
Domain Service (business rules, orchestration)
   ↓
Repository (only layer that touches Supabase)
   ↓
Database (Postgres + RLS — the final authorization boundary)
```

**Rules**
- UI components import hooks, never repositories.
- Hooks import services, never the Supabase client.
- Only repositories touch Supabase.
- Redux never holds server data. TanStack Query never holds UI state.
- Security is enforced in Postgres RLS, not in the frontend.

### Repository swap seam

Every feature defines a `Repository` **interface**. Hooks depend on the interface via a composition root (`src/lib/container.ts`), not on a concrete class. Today the concrete is `Supabase<Feature>Repository`; the interface makes it possible to swap in a `Node<Feature>Repository` later without touching hooks or components. See **ADR-0004**.

### Two-tier admin model

| Flag | Question it answers | Scope |
|------|--------------------|-------|
| `profiles.role = 'admin'` | Can this user manage *their own* company? | Company-scoped |
| `profiles.is_platform_admin = true` | Can this user manage *the entire* platform? | Platform-wide (RLS bypass) |

See **ADR-0007** and **ADR-0008**.

---

## Project Structure

```
src/
├── app/                              Next.js App Router
│   ├── (auth)/                       Login, signup, reset-password
│   ├── accept-invite/                Invitee onboarding
│   ├── api/
│   │   ├── auth/callback/            PKCE callback
│   │   └── cron/sweep-orphaned-auth/ Vercel cron
│   ├── how-it-works/
│   ├── kanban/                       Default board
│   ├── teams/[teamId]/board/
│   ├── employees/                    Admin surface
│   ├── layout.tsx                    Root layout
│   └── Providers.tsx                 QueryClient + Redux providers
│
├── features/                         Feature-first slices
│   ├── auth/         { hooks, repositories, services, types, utils }
│   ├── employees/    { hooks, repositories, services, types, components }
│   ├── kanban/       { components, types }
│   ├── tasks/        { hooks, repositories, services, types }
│   └── teams/        { hooks, repositories, services, types, components, utils }
│
├── lib/
│   ├── supabase/
│   │   ├── browser.ts                Anon key + cookie session (browser)
│   │   └── server.ts                 Server client + service-role factory
│   ├── env.public.ts                 Browser-safe env vars
│   ├── env.server.ts                 Server-only env vars
│   ├── container.ts                  Composition root (wires repositories)
│   └── errors.ts                     Normalised error type
│
├── store/                            Redux (UI state only)
│   ├── index.ts
│   └── slices/
│
└── middleware.ts                     Session enforcement, status-claim gating

supabase/
├── config.toml
└── migrations/                       SQL migrations (auth, teams, employees, tasks, RLS)

docs/
├── PROJECT_CONTEXT.md                Master architecture document
├── adr/                              15 Architecture Decision Records
├── prd/                              5 Product Requirement Documents
└── handoffs/
```

---

## Documentation

- **[docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)** — the single source of architectural truth. Read this before proposing structural changes.
- **[docs/adr/](docs/adr/)** — 15 ADRs. Highlights:
  - `0003` — RLS is the authorization boundary
  - `0004` — Repository/Service swap seam
  - `0005` — TanStack Query for server state, Redux for UI state
  - `0006` — Multi-tenancy `company_id` from day one
  - `0011` — App Router middleware for session enforcement
  - `0014` — First-user-wins platform admin bootstrap
  - `0015` — Server Actions for privileged operations
- **[docs/prd/](docs/prd/)** — feature PRDs for auth, teams, employees, tasks, and employee-lifecycle deletion.
- **[CLAUDE.md](CLAUDE.md)** — engineering rules for AI subagents working in this repo.

---

## Development

This repo uses Claude Code subagents (tech-lead, backend-engineer, frontend-engineer, postgres-supabase-architect, senior-code-reviewer) for planned work. The shared engineering rules live in `CLAUDE.md`; role-specific rules live in `.claude/agents/`. Every agent's output is reviewed before the next agent starts.

Guiding principle: *Build for one company. Design for many companies.*

---

## License

Private.
