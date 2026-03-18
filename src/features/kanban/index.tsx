"use client";

import { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store";
import KanbanBody from "./components/KanbanBody";
import KanbanHeader from "./components/KanbanHeader";
import EditModal from "./components/EditModal";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useBoard, useMoveTopic, useUpdateTopic, useUpdateColumn } from "@/api/board";
import type { Topic, Column } from "@/features/kanban/types";

function filterTopicsBySearch(topics: Topic[], searchQuery: string): Topic[] {
  if (!searchQuery.trim()) return topics;
  const q = searchQuery.toLowerCase().trim();
  return topics.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q))
  );
}

function groupTopicsByColumnId(topics: Topic[]): Record<string, Topic[]> {
  const map: Record<string, Topic[]> = {};
  for (const t of topics) {
    if (!map[t.columnId]) map[t.columnId] = [];
    map[t.columnId].push(t);
  }
  for (const arr of Object.values(map)) {
    arr.sort((a, b) => a.order - b.order);
  }
  return map;
}

type EditTarget =
  | { type: "topic"; topic: Topic }
  | { type: "column"; column: Column }
  | null;

const KanbanDashBoard = () => {
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);
  const searchQuery = useSelector((state: RootState) => state.ui.searchQuery);
  const { data: board, isLoading, isError } = useBoard(currentUser?.id);
  const moveTopic = useMoveTopic();
  const updateTopic = useUpdateTopic();
  const updateColumn = useUpdateColumn();
  const [editTarget, setEditTarget] = useState<EditTarget>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !board || !currentUser) return;
      const topicId = String(active.id);
      const columnIds = new Set(board.columns.map((c) => c.id));
      let newColumnId: string;
      if (columnIds.has(String(over.id))) {
        newColumnId = String(over.id);
      } else {
        const topicOver = board.topics.find((t) => t.id === String(over.id));
        newColumnId = topicOver ? topicOver.columnId : "";
      }
      if (!newColumnId) return;
      const topic = board.topics.find((t) => t.id === topicId);
      if (!topic || topic.columnId === newColumnId) return;
      moveTopic.mutateAsync({
        topicId,
        newColumnId,
        boardId: board.id,
        userId: currentUser.id,
      });
    },
    [board, currentUser, moveTopic]
  );

  const topicsByColumnId = useMemo(() => {
    if (!board?.topics) return {};
    const filtered = filterTopicsBySearch(board.topics, searchQuery);
    return groupTopicsByColumnId(filtered);
  }, [board?.topics, searchQuery]);

  if (isLoading || !board) {
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

  if (isError) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Failed to load board.</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Try refreshing the page.</p>
        </div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <KanbanBody
          boardId={board.id}
          userId={currentUser!.id}
          columns={board.columns}
          topicsByColumnId={topicsByColumnId}
          onEditTopic={(topic) => setEditTarget({ type: "topic", topic })}
          onEditColumn={(column) => setEditTarget({ type: "column", column })}
        />
      </div>
      <EditModal
        target={editTarget}
        boardId={board.id}
        userId={currentUser!.id}
        onClose={() => setEditTarget(null)}
        onSaveTopic={(params) => updateTopic.mutateAsync(params)}
        onSaveColumn={(params) => updateColumn.mutateAsync(params)}
      />
    </DndContext>
  );
};

export default KanbanDashBoard;
