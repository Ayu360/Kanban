"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Task, TaskPriority } from "@/features/tasks/types";
import { useEmployeeDirectory } from "@/features/employees/hooks/useEmployeeDirectory";

interface KanbanCardProps {
  task: Task;
  onEdit: () => void;
  isMobile: boolean;
  onMoveRequest: () => void;
}

const PRIORITY_PILL: Record<TaskPriority, string> = {
  low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  high: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

function formatDate(iso: string): string {
  // Renders YYYY-MM-DD as "Aug 21" style without timezone conversion.
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const KanbanCard: React.FC<KanbanCardProps> = ({
  task,
  onEdit,
  isMobile,
  onMoveRequest,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // M-1 fix: parse both sides as local midnight to avoid UTC-offset false-overdue.
  // new Date("YYYY-MM-DD") parses as UTC midnight; using the 3-arg constructor
  // (year, month, day) always produces local midnight — consistent with formatDate().
  let isOverdue = false;
  if (task.dueDate !== null) {
    const [y, m, d] = task.dueDate.split("-").map(Number);
    const dueDateLocal = new Date(y, m - 1, d);
    const todayLocal = new Date();
    todayLocal.setHours(0, 0, 0, 0);
    isOverdue = dueDateLocal < todayLocal;
  }

  // H-1/H-2: resolve assignee from directory.
  // useEmployeeDirectory is cached per query key ['employees', 'directory'] with
  // 5-min staleTime — one shared fetch across all cards; no N+1 concern.
  const { employees } = useEmployeeDirectory();
  const resolvedAssignee =
    task.assigneeId !== null
      ? (employees.find((e) => e.id === task.assigneeId) ?? null)
      : null;
  // Non-null assigneeId not in directory = deactivated employee (hard-deleted
  // employees have assigneeId set to null via FK ON DELETE SET NULL, so a
  // non-null id missing from the view can only be deactivated).
  const isDeactivatedAssignee =
    task.assigneeId !== null && resolvedAssignee === null;

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
        {task.title}
      </p>

      {task.description ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
          {task.description}
        </p>
      ) : null}

      {/* Metadata row: priority + due date + assignee */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_PILL[task.priority]}`}
        >
          {task.priority}
        </span>

        {task.dueDate !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
              isOverdue
                ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                : "bg-slate-50 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
            }`}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {formatDate(task.dueDate)}
          </span>
        )}

        {/* H-1: active assignee name chip */}
        {resolvedAssignee !== null && (
          <span
            className="inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/20 dark:text-sky-400"
            aria-label={`Assigned to ${resolvedAssignee.displayName ?? "unknown"}`}
          >
            {resolvedAssignee.displayName}
          </span>
        )}

        {/* H-2: deactivated assignee indicator */}
        {isDeactivatedAssignee && (
          <span
            className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-400 opacity-60 dark:bg-slate-700 dark:text-slate-500"
            aria-label="Assignee is deactivated"
          >
            Deactivated employee
          </span>
        )}
      </div>

      {/* Edit button — hidden until hover (desktop) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-sky-600 opacity-0 transition hover:text-sky-700 group-hover:opacity-100 dark:text-sky-400 dark:hover:text-sky-300"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        Edit
      </button>
    </div>
  );
};

export default KanbanCard;
