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

const LOCAL_TOPIC_PREFIX = "local_";

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

const KanbanDashBoard = () => {
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);
  const searchQuery = useSelector((state: RootState) => state.ui.searchQuery);
  const { data: board, isLoading, isError } = useBoard(currentUser?.id);
  const moveTopic = useMoveTopic();
  const updateTopic = useUpdateTopic();
  const updateColumn = useUpdateColumn();
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [localTopics, setLocalTopics] = useState<Topic[]>([]);
  const [addCardColumnId, setAddCardColumnId] = useState<string | null>(null);
  const [moveTargetTopic, setMoveTargetTopic] = useState<Topic | null>(null);
  const isMobile = useIsMobile();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const allTopics = useMemo(
    () => [...(board?.topics ?? []), ...localTopics],
    [board?.topics, localTopics]
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (isMobile) return;
      const { active, over } = event;
      if (!over || !board || !currentUser) return;
      const topicId = String(active.id);
      const columnIds = new Set(board.columns.map((c) => c.id));
      let newColumnId: string;
      if (columnIds.has(String(over.id))) {
        newColumnId = String(over.id);
      } else {
        const topicOver = allTopics.find((t) => t.id === String(over.id));
        newColumnId = topicOver ? topicOver.columnId : "";
      }
      if (!newColumnId) return;
      const topic = allTopics.find((t) => t.id === topicId);
      if (!topic || topic.columnId === newColumnId) return;
      if (topicId.startsWith(LOCAL_TOPIC_PREFIX)) {
        setLocalTopics((prev) =>
          prev.map((t) =>
            t.id === topicId ? { ...t, columnId: newColumnId } : t
          )
        );
      } else {
        moveTopic.mutateAsync({
          topicId,
          newColumnId,
          boardId: board.id,
          userId: currentUser.id,
        });
      }
    },
    [board, currentUser, moveTopic, allTopics, isMobile]
  );

  const topicsByColumnId = useMemo(() => {
    const filtered = filterTopicsBySearch(allTopics, searchQuery);
    return groupTopicsByColumnId(filtered);
  }, [allTopics, searchQuery]);

  const handleAddCard = useCallback((columnId: string, title: string, description: string) => {
    if (!board) return;
    const column = board.columns.find((c) => c.id === columnId);
    const maxOrder = Math.max(
      0,
      ...allTopics.filter((t) => t.columnId === columnId).map((t) => t.order)
    );
    const newTopic: Topic = {
      id: `${LOCAL_TOPIC_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`,
      columnId,
      boardId: board.id,
      title,
      description,
      order: maxOrder + 1,
    };
    setLocalTopics((prev) => [...prev, newTopic]);
    setAddCardColumnId(null);
  }, [board, allTopics]);

  const handleSaveTopic = useCallback(
    (params: { id: string; title: string; description: string; boardId: string; userId: string }) => {
      if (params.id.startsWith(LOCAL_TOPIC_PREFIX)) {
        setLocalTopics((prev) =>
          prev.map((t) =>
            t.id === params.id
              ? { ...t, title: params.title, description: params.description }
              : t
          )
        );
      } else {
        updateTopic.mutateAsync(params);
      }
    },
    [updateTopic]
  );

  const handleMoveTopicToColumn = useCallback(
    (topic: Topic, newColumnId: string) => {
      if (!board || !currentUser) return;
      if (!newColumnId || topic.columnId === newColumnId) return;

      const topicId = topic.id;
      if (topicId.startsWith(LOCAL_TOPIC_PREFIX)) {
        setLocalTopics((prev) =>
          prev.map((t) =>
            t.id === topicId ? { ...t, columnId: newColumnId } : t
          )
        );
      } else {
        moveTopic.mutateAsync({
          topicId,
          newColumnId,
          boardId: board.id,
          userId: currentUser.id,
        });
      }
    },
    [board, currentUser, moveTopic]
  );

  const addCardColumn = board?.columns.find((c) => c.id === addCardColumnId);

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
          onAddCard={(columnId: string) => setAddCardColumnId(columnId)}
          isMobile={isMobile}
          onMoveTopicRequest={(topic) => setMoveTargetTopic(topic)}
        />
      </div>
      <EditModal
        target={editTarget}
        boardId={board.id}
        userId={currentUser!.id}
        onClose={() => setEditTarget(null)}
        onSaveTopic={handleSaveTopic}
        onSaveColumn={(params) => updateColumn.mutateAsync(params)}
      />
      {addCardColumn && (
        <AddCardModal
          columnTitle={addCardColumn.title}
          onClose={() => setAddCardColumnId(null)}
          onSubmit={(title, description) =>
            handleAddCard(addCardColumn.id, title, description)
          }
        />
      )}
      <MoveCardModal
        topic={moveTargetTopic}
        columns={board.columns}
        isOpen={!!moveTargetTopic && isMobile}
        onClose={() => setMoveTargetTopic(null)}
        onConfirm={(columnId) => {
          if (moveTargetTopic) {
            handleMoveTopicToColumn(moveTargetTopic, columnId);
          }
          setMoveTargetTopic(null);
        }}
      />
    </DndContext>
  );
};

export default KanbanDashBoard;
