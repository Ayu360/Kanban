"use client";

/**
 * EmployeeConfirmDialog — accessible confirmation dialog for employee actions.
 *
 * Supports two visual variants:
 *   'default'     — neutral actions (role change)
 *   'destructive' — danger actions (deactivation)
 *
 * Mirrors the Teams ConfirmDialog pattern but adds a variant prop so the
 * same component handles both role-change (sky confirm button) and
 * deactivation (red confirm button) flows without duplication.
 *
 * Accessibility:
 *   - role="dialog" aria-modal="true"
 *   - aria-labelledby / aria-describedby wired to title/body
 *   - Escape key closes (unless pending)
 *   - useFocusTrap handles Tab/Shift+Tab cycle, trigger restore on close
 */

import { useEffect } from "react";
import { useFocusTrap } from "@/features/teams/hooks/useFocusTrap";

interface EmployeeConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  isPending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EmployeeConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  isPending = false,
  pendingLabel,
  onConfirm,
  onCancel,
}: EmployeeConfirmDialogProps) {
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

  const confirmButtonClass =
    variant === "destructive"
      ? "flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
      : "flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={isPending ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="emp-confirm-title"
      aria-describedby="emp-confirm-desc"
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <h2
          id="emp-confirm-title"
          className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          {title}
        </h2>
        <p
          id="emp-confirm-desc"
          className="mb-6 text-sm leading-relaxed text-slate-600 dark:text-slate-400"
        >
          {description}
        </p>
        <div className="flex justify-end gap-2">
          {/* Cancel MUST remain the first button in DOM order.
              useFocusTrap schedules focus via requestAnimationFrame after React
              commit; if Cancel is moved later in the DOM, the trap will land on
              whichever button is first and silently override autoFocus,
              breaking the WCAG accidental-action safety property for the
              destructive variant. */}
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            autoFocus={variant === "destructive"}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={confirmButtonClass}
          >
            {isPending && (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden
              />
            )}
            {isPending ? (pendingLabel ?? "Processing...") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
