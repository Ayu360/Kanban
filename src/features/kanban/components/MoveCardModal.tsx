"use client";

import type { Column, Topic } from "@/features/kanban/types";
import { useEffect, useState } from "react";

interface MoveCardModalProps {
  topic: Topic | null;
  columns: Column[];
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (columnId: string) => void;
}

export default function MoveCardModal({
  topic,
  columns,
  isOpen,
  onClose,
  onConfirm,
}: MoveCardModalProps) {
  const [selectedColumnId, setSelectedColumnId] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    if (topic) {
      setSelectedColumnId(topic.columnId);
    }
  }, [topic]);

  useEffect(() => {
    if (!isOpen || !topic) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, topic]);

  if (!isOpen || !topic) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColumnId || selectedColumnId === topic.columnId) {
      onClose();
      return;
    }
    onConfirm(selectedColumnId);
  };

  const selectedColumn =
    columns.find((column) => column.id === selectedColumnId) ?? columns[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-card-title"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="move-card-title"
          className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Move card
        </h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Choose a column to move{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {topic.title}
          </span>{" "}
          to.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Destination column
            </label>
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                onClick={() => setIsDropdownOpen((open) => !open)}
              >
                <span>{selectedColumn?.title}</span>
                <svg
                  className="ml-2 h-4 w-4 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {isDropdownOpen && (
                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                  {columns.map((column) => (
                    <button
                      key={column.id}
                      type="button"
                      onClick={() => {
                        setSelectedColumnId(column.id);
                        setIsDropdownOpen(false);
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm ${
                        column.id === selectedColumnId
                          ? "bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                          : "text-slate-700 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/60"
                      }`}
                    >
                      {column.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
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
              Move
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

