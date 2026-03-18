"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Topic } from "@/features/kanban/types";

interface KanbanCardProps {
  topic: Topic;
  onEdit: () => void;
  isMobile: boolean;
  onMoveRequest: () => void;
}

const KanbanCard: React.FC<KanbanCardProps> = ({
  topic,
  onEdit,
  isMobile,
  onMoveRequest,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: topic.id,
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border bg-white p-3 text-left shadow-sm dark:bg-slate-800 dark:border-slate-600 sm:p-4 ${
        isDragging
          ? "z-50 rotate-2 shadow-lg ring-2 ring-sky-500/50"
          : "transition-shadow hover:shadow-md" +
            (isMobile ? "" : " cursor-grab active:cursor-grabbing")
      }`}
      {...(!isMobile ? { ...attributes, ...listeners } : {})}
      onClick={isMobile ? onMoveRequest : undefined}
    >
      <p className="font-medium text-slate-900 dark:text-slate-100">
        {topic.title}
      </p>
      {topic.description ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
          {topic.description}
        </p>
      ) : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-sky-600 opacity-0 transition hover:text-sky-700 group-hover:opacity-100 dark:text-sky-400 dark:hover:text-sky-300"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Edit
      </button>
    </div>
  );
};

export default KanbanCard;
