"use client";

import KanbanColumn from "./KanbanColumn";
import type { Column, Task } from "@/features/tasks/types";

interface KanbanBodyProps {
  columns: Column[];
  tasksByColumnId: Record<string, Task[]>;
  onEditTask: (task: Task) => void;
  onAddCard: (columnId: string) => void;
  isMobile: boolean;
  onMoveTaskRequest: (task: Task) => void;
}

const KanbanBody: React.FC<KanbanBodyProps> = ({
  columns,
  tasksByColumnId,
  onEditTask,
  onAddCard,
  isMobile,
  onMoveTaskRequest,
}) => {
  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-8 pt-4 sm:px-6 sm:pt-6 sm:pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6 sm:overflow-x-auto sm:pb-2 sm:-mx-6 sm:px-6 sm:snap-x sm:snap-mandatory">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={tasksByColumnId[column.id] ?? []}
            onEditTask={onEditTask}
            onAddCard={onAddCard}
            isMobile={isMobile}
            onMoveTaskRequest={onMoveTaskRequest}
          />
        ))}
      </div>
    </div>
  );
};

export default KanbanBody;
