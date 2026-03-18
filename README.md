# Kanban Board Demo

A front-end demo project showcasing **TanStack Query** and **Redux** with a Kanban board: fake multi-user login, data-driven columns, drag-and-drop, search, and edit. No backend—all data lives in an in-memory fake API.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Client state | Redux Toolkit |
| Server-state / data fetching | TanStack Query (React Query) |
| Drag and drop | @dnd-kit |
| Language | TypeScript |

---

## Features

- **Fake login** — Pick one of three users (Alice, Bob, Carol). Each user has their own board. Current user is stored in Redux and optionally persisted in `localStorage`.
- **User switcher** — Change user from the header dropdown without leaving the board.
- **Scalable columns** — Columns are data-driven (e.g. To Do, In Progress, Done). Easy to add new categories by extending the fake data.
- **Drag and drop** — Move topics (cards) between columns. Updates go through TanStack Query mutations and the board refetches.
- **Search** — Filter topics by title or description. Search query is in Redux; results are filtered before rendering.
- **Edit** — Edit a topic (title + description) or a column title via a modal. Uses TanStack Query mutations; board invalidates and refetches.

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm (or yarn/pnpm)

### Install and run

```bash
# Install dependencies
npm install

# Run in development
npm run debug

# Build for production
npm run build

# Run production build
npm start
```

Then open [http://localhost:3000](http://localhost:3000). You’ll be redirected to `/login` or `/kanban` depending on auth state.

### Scripts

| Script | Description |
|--------|-------------|
| `npm run debug` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Run production server |
| `npm run lint` | Run ESLint |

---

## Routes

| Path | Description |
|------|-------------|
| `/` | Redirects to `/login` or `/kanban` based on current user |
| `/login` | Fake login: choose a user to enter the app |
| `/kanban` | Main board (guarded: redirects to `/login` if not logged in) |

---

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout, wraps app with Providers
│   ├── page.tsx            # Home → redirect to login or kanban
│   ├── login/page.tsx      # Fake login page
│   ├── kanban/page.tsx     # Board page (auth guard)
│   ├── Providers.tsx       # Redux + TanStack Query providers
│   └── AuthHydration.tsx   # Restores user from localStorage
│
├── store/                  # Redux
│   ├── index.ts            # Store config
│   └── slices/
│       ├── authSlice.ts    # currentUser, setUser, clearUser
│       └── uiSlice.ts      # searchQuery
│
├── api/                    # TanStack Query
│   └── board.ts            # useBoard, useMoveTopic, useUpdateTopic, useUpdateColumn
│
├── lib/
│   └── fakeApi.ts          # In-memory data + getBoard, moveTopic, updateTopic, updateColumn
│
└── features/kanban/
    ├── index.tsx           # Kanban dashboard: useBoard, onDragEnd, edit state, filter by search
    ├── types/
    │   ├── index.ts        # User, Board, Column, Topic, etc.
    │   └── interface/       # Re-exports for components
    └── components/
        ├── KanbanHeader.tsx   # Title, search input, user switcher
        ├── KanbanBody.tsx     # Maps columns, passes topics per column
        ├── KanbanColumn.tsx   # Droppable column, column title (editable), list of cards
        ├── KanbanCard.tsx     # Draggable topic card, Edit button
        └── EditModal.tsx      # Form for editing topic or column
```

---

## How It Works

### Auth and routing

- **Redux** holds `currentUser` (and optionally `storedUserId` for rehydration).
- On load, `AuthHydration` reads `localStorage` and, if a stored user id exists, fetches fake users and sets `currentUser`.
- `/login`: choose a user → `setUser` → redirect to `/kanban`.
- `/kanban`: if `currentUser` is null, redirect to `/login`.

### Board data

- **TanStack Query** is the source of truth for board data. `useBoard(userId)` calls the fake API and returns board, columns, and topics.
- The **fake API** (`src/lib/fakeApi.ts`) keeps per-user data in memory. Each user gets a board with three columns and a few topics. Mutations (`moveTopic`, `updateTopic`, `updateColumn`) update that in-memory state.
- After any mutation, the board query is invalidated so the UI refetches and stays in sync.

### Search

- **Redux** holds `searchQuery` (updated from the header input with a short debounce).
- The dashboard filters `board.topics` by title/description against `searchQuery`, then groups the result by `columnId` and passes it to `KanbanBody`. Only matching topics are shown.

### Drag and drop

- **@dnd-kit** is used: each column is a droppable (id = `column.id`), each card is draggable (id = `topic.id`).
- On `onDragEnd`, the dashboard reads `active.id` (topic) and `over.id` (target column), then calls `useMoveTopic().mutateAsync(...)`. The fake API updates the topic’s `columnId`, and query invalidation refetches the board.

### Edit

- The dashboard keeps `editTarget` (topic or column or null). Clicking “Edit” on a card or the column header sets `editTarget` and opens `EditModal`.
- The modal calls `onSaveTopic` or `onSaveColumn`, which trigger `useUpdateTopic` or `useUpdateColumn`. The fake API is updated and the board query is invalidated.

---

## Adding More Users or Columns

- **Users:** In `src/lib/fakeApi.ts`, extend the array returned by `getFakeUsers()` and ensure `createInitialBoardForUser(userId)` is used when that user’s board is first requested (it’s called from `getOrCreateUserBoard`).
- **Columns:** In `createInitialBoardForUser()` in `src/lib/fakeApi.ts`, add another object to the `columns` array (with a unique `id`, `boardId`, `category`, `title`, `order`). New columns will appear automatically; you can add initial topics in the `topics` array with the new column’s `id` as `columnId`.

---

## License

Private / demo project.
