"use client";

/**
 * ConfirmDialog — accessible destructive-action confirmation dialog.
 *
 * Used for team deletion (and potentially other destructive flows).
 * Follows the existing modal pattern: backdrop click closes, escape key
 * closes, focus is trapped within the dialog while open.
 *
 * Accessibility:
 *   - role="dialog" aria-modal="true"
 *   - aria-labelledby / aria-describedby wired to title/body
 *   - Destructive confirm button is styled in red to signal danger
 *   - Loading state disables both buttons and shows a spinner
 *   - useFocusTrap handles: initial focus, Tab/Shift+Tab trap, trigger restore
 */

import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const containerRef = useFocusTrap(isOpen);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Escape key closes the dialog.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, isPending, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={isPending ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        // tabIndex allows the container itself to receive focus as a fallback
        // when no focusable children exist yet (e.g. during transition).
        tabIndex={-1}
      >
        <h2
          id="confirm-dialog-title"
          className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-desc"
          className="mb-6 text-sm leading-relaxed text-slate-600 dark:text-slate-400"
        >
          {description}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
          >
            {isPending && (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden
              />
            )}
            {isPending ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
