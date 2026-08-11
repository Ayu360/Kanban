"use client";

/**
 * TeamFormModal — Create or rename a team.
 *
 * Used for both create (no initialName) and rename (initialName provided).
 * Validates name client-side (non-empty, max 100 chars) and surfaces backend
 * errors (CONFLICT, VALIDATION_ERROR, etc.) in an accessible error alert.
 *
 * Follows the existing modal pattern (AddCardModal, EditModal).
 *
 * Accessibility:
 *   - role="dialog" aria-modal aria-labelledby
 *   - Error alert has role="alert" for screen readers
 *   - Escape key closes when not pending
 *   - useFocusTrap handles: initial focus, Tab/Shift+Tab trap, trigger restore
 */

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface TeamFormModalProps {
  mode: "create" | "rename";
  initialName?: string;
  isPending: boolean;
  errorMessage: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 100;

export default function TeamFormModal({
  mode,
  initialName = "",
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: TeamFormModalProps) {
  const [name, setName] = useState(initialName);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // TeamFormModal is always mounted when visible, so isOpen is always true here.
  const containerRef = useFocusTrap(true);

  const titleText = mode === "create" ? "Create team" : "Rename team";
  const submitLabel = mode === "create" ? "Create team" : "Save";
  const pendingLabel = mode === "create" ? "Creating..." : "Saving...";

  // Lock scroll on mount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // useFocusTrap moves focus to the first focusable element in the container.
  // The input is the first focusable element, so it receives focus automatically.
  // We keep the inputRef for potential programmatic re-focus after errors.

  // Escape closes (unless pending).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isPending, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const trimmed = name.trim();

    if (!trimmed) {
      setLocalError("Team name is required.");
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setLocalError(`Team name must be ${MAX_NAME_LENGTH} characters or fewer.`);
      inputRef.current?.focus();
      return;
    }

    onSubmit(trimmed);
  };

  // Display backend error if present, otherwise local validation error.
  const displayedError = errorMessage ?? localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={isPending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-form-title"
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <h2
          id="team-form-title"
          className="mb-5 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          {titleText}
        </h2>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="team-name-input"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Team name
            </label>
            <input
              ref={inputRef}
              id="team-name-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setLocalError(null);
              }}
              placeholder="e.g. Engineering"
              maxLength={MAX_NAME_LENGTH + 1}
              disabled={isPending}
              aria-describedby={displayedError ? "team-name-error" : undefined}
              aria-invalid={!!displayedError}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
            {displayedError && (
              <p
                id="team-name-error"
                role="alert"
                className="mt-1.5 text-xs text-red-600 dark:text-red-400"
              >
                {displayedError}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
            >
              {isPending && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
              )}
              {isPending ? pendingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
