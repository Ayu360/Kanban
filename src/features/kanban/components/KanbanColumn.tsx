"use client";

import { useDroppable } from "@dnd-kit/core";
import KanbanCard from "./KanbanCard";
import type { Column, Topic } from "@/features/kanban/types";

interface KanbanColumnProps {
  column: Column;
  topics: Topic[];
  onEditTopic: (topic: Topic) => void;
  onEditColumn: (column: Column) => void;
  onAddCard: (columnId: string) => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  topics,
  onEditTopic,
  onEditColumn,
  onAddCard,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id: column.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-full flex-col shrink-0 rounded-xl border-2 border-dashed transition-colors sm:min-w-[280px] sm:max-w-[320px] sm:flex-1 sm:snap-center ${
        isOver
          ? "border-sky-400 bg-sky-50/50 dark:border-sky-500 dark:bg-sky-900/10"
          : "border-slate-200 bg-slate-50/80 dark:border-slate-600 dark:bg-slate-800/50"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-600 sm:px-4 sm:py-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 sm:text-sm">
          {column.title}
        </h2>
        <button
          type="button"
          onClick={() => onEditColumn(column)}
          className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          title="Edit column"
          aria-label={`Edit column ${column.title}`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-[280px] flex-col gap-2 p-3 sm:min-h-[320px] sm:gap-3 sm:p-4">
        {topics.map((topic) => (
          <KanbanCard
            key={topic.id}
            topic={topic}
            onEdit={() => onEditTopic(topic)}
          />
        ))}
        <button
          type="button"
          onClick={() => onAddCard(column.id)}
          className="mt-1 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-500 transition hover:border-sky-300 hover:bg-sky-50/50 hover:text-sky-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-sky-500 dark:hover:bg-sky-900/10 dark:hover:text-sky-400"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add card
        </button>
      </div>
    </div>
  );
};

export default KanbanColumn;
