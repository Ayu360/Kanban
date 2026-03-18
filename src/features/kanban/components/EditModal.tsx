"use client";

import { useEffect, useState } from "react";
import type { Column, Topic } from "@/features/kanban/types";

type EditTarget =
  | { type: "topic"; topic: Topic }
  | { type: "column"; column: Column };

interface EditModalProps {
  target: EditTarget | null;
  boardId: string;
  userId: string;
  onClose: () => void;
  onSaveTopic: (params: {
    id: string;
    title: string;
    description: string;
    boardId: string;
    userId: string;
  }) => void;
  onSaveColumn: (params: {
    id: string;
    title: string;
    boardId: string;
    userId: string;
  }) => void;
}

export default function EditModal({
  target,
  boardId,
  userId,
  onClose,
  onSaveTopic,
  onSaveColumn,
}: EditModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!target) return;
    if (target.type === "topic") {
      setTitle(target.topic.title);
      setDescription(target.topic.description ?? "");
    } else {
      setTitle(target.column.title);
      setDescription("");
    }
  }, [target]);

  if (!target) return null;

  const isTopic = target.type === "topic";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isTopic) {
      onSaveTopic({
        id: target.topic.id,
        title,
        description,
        boardId,
        userId,
      });
    } else {
      onSaveColumn({
        id: target.column.id,
        title,
        boardId,
        userId,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-modal-title"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-modal-title" className="mb-5 text-lg font-semibold text-slate-900 dark:text-slate-100">
          Edit {isTopic ? "task" : "column"}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="edit-title" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Title
            </label>
            <input
              id="edit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
          </div>
          {isTopic && (
            <div>
              <label htmlFor="edit-desc" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Description
              </label>
              <textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
