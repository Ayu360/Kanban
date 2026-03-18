import type { User, Board, Column, Topic, BoardWithDetails } from "@/features/kanban/types";

const DELAY_MS = 300;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS));
}

function createInitialBoardForUser(userId: string): { board: Board; columns: Column[]; topics: Topic[] } {
  const boardId = `board_${userId}`;
  const board: Board = { id: boardId, userId, name: "My Board" };
  const columns: Column[] = [
    { id: `col_${userId}_todo`, boardId, category: "todo", title: "To Do", order: 0 },
    { id: `col_${userId}_progress`, boardId, category: "in_progress", title: "In Progress", order: 1 },
    { id: `col_${userId}_done`, boardId, category: "done", title: "Done", order: 2 },
  ];
  const topics: Topic[] = [
    { id: `topic_${userId}_1`, columnId: columns[0].id, boardId, title: "Add unit tests for auth slice", description: "Cover setUser, clearUser, and localStorage persistence with Jest + React Testing Library.", order: 0 },
    { id: `topic_${userId}_2`, columnId: columns[0].id, boardId, title: "Implement error boundaries", description: "Add React error boundaries around board and column to prevent full-app crash on render errors.", order: 1 },
    { id: `topic_${userId}_3`, columnId: columns[0].id, boardId, title: "Refactor API hooks into custom hook", description: "Create useBoardMutations() that returns moveTopic, updateTopic, updateColumn with queryClient wired.", order: 2 },
    { id: `topic_${userId}_4`, columnId: columns[1].id, boardId, title: "Optimize re-renders with React.memo", description: "Memoize KanbanColumn and KanbanCard where props are stable to reduce re-renders on search.", order: 0 },
    { id: `topic_${userId}_5`, columnId: columns[1].id, boardId, title: "Add loading skeletons for board", description: "Show skeleton placeholders for columns and cards while useBoard is loading.", order: 1 },
    { id: `topic_${userId}_6`, columnId: columns[2].id, boardId, title: "Document TanStack Query keys", description: "Add JSDoc or README section explaining boardKeys and invalidation strategy.", order: 0 },
    { id: `topic_${userId}_7`, columnId: columns[2].id, boardId, title: "Setup CI pipeline", description: "Add GitHub Actions workflow for lint, typecheck, and build on push/PR.", order: 1 },
  ];
  return { board, columns, topics };
}

const store = new Map<string, { board: Board; columns: Column[]; topics: Topic[] }>();

function getOrCreateUserBoard(userId: string) {
  let data = store.get(userId);
  if (!data) {
    const initial = createInitialBoardForUser(userId);
    data = {
      board: { ...initial.board },
      columns: initial.columns.map((c) => ({ ...c })),
      topics: initial.topics.map((t) => ({ ...t })),
    };
    store.set(userId, data);
  }
  return data;
}

export async function getFakeUsers(): Promise<User[]> {
  return delay([
    { id: "user_1", name: "Alice" },
    { id: "user_2", name: "Bob" },
    { id: "user_3", name: "Carol" },
  ]);
}

export async function getBoard(userId: string): Promise<BoardWithDetails> {
  const { board, columns, topics } = getOrCreateUserBoard(userId);
  return delay({
    ...board,
    columns: [...columns].sort((a, b) => a.order - b.order),
    topics: [...topics],
  });
}

export async function moveTopic(params: {
  topicId: string;
  newColumnId: string;
  boardId: string;
  userId: string;
}): Promise<void> {
  const { topicId, newColumnId, boardId, userId } = params;
  const data = getOrCreateUserBoard(userId);
  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic || topic.boardId !== boardId) return delay(undefined) as Promise<void>;
  const maxOrder = Math.max(0, ...data.topics.filter((t) => t.columnId === newColumnId).map((t) => t.order));
  topic.columnId = newColumnId;
  topic.order = maxOrder + 1;
  return delay(undefined) as Promise<void>;
}

export async function updateTopic(params: {
  id: string;
  title: string;
  description: string;
  boardId: string;
  userId: string;
}): Promise<Topic> {
  const { id, title, description, boardId, userId } = params;
  const data = getOrCreateUserBoard(userId);
  const topic = data.topics.find((t) => t.id === id && t.boardId === boardId);
  if (!topic) return delay({} as Topic);
  topic.title = title;
  topic.description = description;
  return delay({ ...topic });
}

export async function updateColumn(params: {
  id: string;
  title: string;
  boardId: string;
  userId: string;
}): Promise<Column> {
  const { id, title, boardId, userId } = params;
  const data = getOrCreateUserBoard(userId);
  const column = data.columns.find((c) => c.id === id && c.boardId === boardId);
  if (!column) return delay({} as Column);
  column.title = title;
  return delay({ ...column });
}
