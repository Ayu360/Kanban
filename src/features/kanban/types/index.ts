export interface User {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface Board {
  id: string;
  userId: string;
  name: string;
}

export type ColumnCategory = "todo" | "in_progress" | "done" | "backlog";

export interface Column {
  id: string;
  boardId: string;
  category: ColumnCategory;
  title: string;
  order: number;
}

export interface Topic {
  id: string;
  columnId: string;
  boardId: string;
  title: string;
  description: string;
  order: number;
}

export interface BoardWithDetails extends Board {
  columns: Column[];
  topics: Topic[];
}

export interface KanbanProps {
  id: string;
}

export interface KanbanColumnProps {
  column: Column;
  topics: Topic[];
}

export interface KanbanCardProps {
  topic: Topic;
}
