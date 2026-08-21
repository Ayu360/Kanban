"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store";
import KanbanBody from "./components/KanbanBody";
import KanbanHeader from "./components/KanbanHeader";
import EditModal from "./components/EditModal";
import AddCardModal from "./components/AddCardModal";
import MoveCardModal from "./components/MoveCardModal";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useBoard, useCreateTask, useMoveTask } from "@/features/tasks/hooks";
import type { Task } from "@/features/tasks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterTasksBySearch(tasks: Task[], searchQuery: string): Task[] {
  if (!searchQuery.trim()) return tasks;
  const q = searchQuery.toLowerCase().trim();
  return tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q))
  );
}

function groupTasksByColumnId(tasks: Task[]): Record<string, Task[]> {
  const map: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!map[t.columnId]) map[t.columnId] = [];
    map[t.columnId].push(t);
  }
  // Tasks within each column are already ordered by position ASC from the server
  return map;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      if (typeof window !== "undefined") {
        setIsMobile(window.innerWidth < 640);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobile;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KanbanDashBoardProps {
  /** The resolved boardId for the current team's board. */
  boardId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const KanbanDashBoard = ({ boardId }: KanbanDashBoardProps) => {
  const searchQuery = useSelector((state: RootState) => state.ui.searchQuery);

  const { board, isLoading, error } = useBoard(boardId);
  const moveTask = useMoveTask();
  const createTask = useCreateTask();

  const [editTask, setEditTask] = useState<Task | null>(null);
  const [addCardColumnId, setAddCardColumnId] = useState<string | null>(null);
  const [moveTargetTask, setMoveTargetTask] = useState<Task | null>(null);
  const isMobile = useIsMobile();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  // Flatten all tasks from all columns for search / drag lookup
  const allTasks = useMemo(
    () => board?.columns.flatMap((c) => c.tasks) ?? [],
    [board]
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (isMobile) return;
      const { active, over } = event;
      if (!over || !board) return;

      const taskId = String(active.id);
      const columnIds = new Set(board.columns.map((c) => c.id));
      let toColumnId: string;

      if (columnIds.has(String(over.id))) {
        toColumnId = String(over.id);
      } else {
        const taskOver = allTasks.find((t) => t.id === String(over.id));
        toColumnId = taskOver ? taskOver.columnId : "";
      }

      if (!toColumnId) return;

      const task = allTasks.find((t) => t.id === taskId);
      if (!task || task.columnId === toColumnId) return;

      // useMoveTask handles the optimistic patch and rollback.
      moveTask.mutate({ taskId, toColumnId, boardId });
    },
    [board, moveTask, allTasks, isMobile, boardId]
  );

  const tasksByColumnId = useMemo(() => {
    const filtered = filterTasksBySearch(allTasks, searchQuery);
    return groupTasksByColumnId(filtered);
  }, [allTasks, searchQuery]);

  const [addCardError, setAddCardError] = useState<string | null>(null);

  const handleAddCard = useCallback(
    (columnId: string, title: string, description: string) => {
      if (!board) return;
      setAddCardError(null);
      createTask.mutate(
        {
          title,
          description: description || undefined,
          columnId,
          boardId: board.id,
          priority: "medium",
        },
        {
          onSuccess: () => {
            setAddCardColumnId(null);
          },
          onError: (err) => {
            // Surface the actual failure so we don't silently close on error.
            console.error("[useCreateTask] failed:", err);
            setAddCardError(
              err instanceof Error && err.message
                ? err.message
                : "Failed to create task. Please try again."
            );
          },
        }
      );
    },
    [board, createTask]
  );

  const handleMoveTaskToColumn = useCallback(
    (task: Task, toColumnId: string) => {
      if (!board) return;
      if (!toColumnId || task.columnId === toColumnId) return;
      moveTask.mutate({ taskId: task.id, toColumnId, boardId: board.id });
    },
    [board, moveTask]
  );

  const addCardColumn = board?.columns.find((c) => c.id === addCardColumnId);

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading board...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Failed to load board.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Try refreshing the page.
          </p>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No board found for this team.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            The board may still be setting up, or you may not have access.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <KanbanBody
          columns={board.columns}
          tasksByColumnId={tasksByColumnId}
          onEditTask={(task) => setEditTask(task)}
          onAddCard={(columnId: string) => setAddCardColumnId(columnId)}
          isMobile={isMobile}
          onMoveTaskRequest={(task) => setMoveTargetTask(task)}
        />
      </div>

      <EditModal
        task={editTask}
        boardId={board.id}
        onClose={() => setEditTask(null)}
      />

      {addCardColumn && (
        <AddCardModal
          columnTitle={addCardColumn.title}
          onClose={() => {
            setAddCardColumnId(null);
            setAddCardError(null);
          }}
          onSubmit={(title, description) =>
            handleAddCard(addCardColumn.id, title, description)
          }
          errorMessage={addCardError}
          isPending={createTask.isPending}
        />
      )}

      <MoveCardModal
        task={moveTargetTask}
        columns={board.columns}
        isOpen={!!moveTargetTask && isMobile}
        onClose={() => setMoveTargetTask(null)}
        onConfirm={(columnId) => {
          if (moveTargetTask) {
            handleMoveTaskToColumn(moveTargetTask, columnId);
          }
          setMoveTargetTask(null);
        }}
      />
    </DndContext>
  );
};

export default KanbanDashBoard;
