"use client";

import KanbanColumn from "./KanbanColumn";
import type { Column, Topic } from "@/features/kanban/types";

interface KanbanBodyProps {
  boardId: string;
  userId: string;
  columns: Column[];
  topicsByColumnId: Record<string, Topic[]>;
  onEditTopic: (topic: Topic) => void;
  onEditColumn: (column: Column) => void;
  onAddCard: (columnId: string) => void;
}

const KanbanBody: React.FC<KanbanBodyProps> = ({
  columns,
  topicsByColumnId,
  onEditTopic,
  onEditColumn,
  onAddCard,
}) => {
  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-8 pt-4 sm:px-6 sm:pt-6 sm:pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6 sm:overflow-x-auto sm:pb-2 sm:-mx-6 sm:px-6 sm:snap-x sm:snap-mandatory">
      {columns.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          topics={topicsByColumnId[column.id] ?? []}
          onEditTopic={onEditTopic}
          onEditColumn={onEditColumn}
          onAddCard={onAddCard}
        />
      ))}
    </div>
  </div>
  );
};

export default KanbanBody;
