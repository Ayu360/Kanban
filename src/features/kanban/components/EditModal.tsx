"use client";

import { useEffect, useState } from "react";
import type { Task, TaskPriority } from "@/features/tasks/types";
import { useUpdateTask } from "@/features/tasks/hooks/useUpdateTask";
import { useDeleteTask } from "@/features/tasks/hooks/useDeleteTask";
import { useEmployeeDirectory } from "@/features/employees/hooks/useEmployeeDirectory";
import ConfirmDialog from "@/features/teams/components/ConfirmDialog";
import type { TasksError } from "@/features/tasks/types";

interface EditModalProps {
  task: Task | null;
  boardId: string;
  onClose: () => void;
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
  medium: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
  high: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
};

function getErrorMessage(error: TasksError): string {
  switch (error.code) {
    case "VALIDATION_ERROR":
      return error.message;
    case "NOT_FOUND":
      return "This item no longer exists. The board has been refreshed.";
    case "FORBIDDEN":
      return "You don't have permission to perform this action.";
    case "UNAUTHENTICATED":
      return "Please sign in to continue.";
    case "CONFLICT":
      return "A conflict occurred. Please refresh and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/**
 * Inner form component — mounted with key={task.id} by EditModal so that
 * React remounts the form whenever a different task is selected. This avoids
 * calling setState synchronously inside useEffect to reset form fields, which
 * triggers cascading renders and is flagged by react-hooks/set-state-in-effect.
 */
interface EditFormProps {
  task: Task;
  boardId: string;
  onClose: () => void;
}

function EditForm({ task, boardId, onClose }: EditFormProps) {
  // Initial values are set from props at mount time.
  // Because the parent mounts this with key={task.id}, these initializers
  // re-run automatically whenever a different task is opened.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState<string>(task.dueDate ?? "");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { employees } = useEmployeeDirectory();

  // M-2 fix: derive whether the stored assigneeId is actually in the active
  // directory. When directory data is present and the ID is missing, the employee
  // is deactivated — treat as unassigned for both the picker and the submit payload.
  // We do NOT call setState inside an effect (project lint rule: react-hooks/set-state-in-effect).
  // Instead, assigneeId state represents the user's explicit picker selection, and
  // effectiveAssigneeId is the derived value used for display and submission.
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assigneeId);

  const isAssigneeDeactivated =
    employees.length > 0 &&
    assigneeId !== null &&
    !employees.some((e) => e.id === assigneeId);

  // The value that goes to the server and drives the picker's controlled value.
  // Null when the stored ID belongs to a deactivated employee.
  const effectiveAssigneeId = isAssigneeDeactivated ? null : assigneeId;

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape key closes the modal (unless delete confirm is open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showDeleteConfirm) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showDeleteConfirm, onClose]);

  // Resolve the display employee from the directory using effectiveAssigneeId.
  // effectiveAssigneeId is null when the stored ID belongs to a deactivated
  // employee, so resolvedAssignee is always null for deactivated assignees.
  const resolvedAssignee = effectiveAssigneeId
    ? (employees.find((e) => e.id === effectiveAssigneeId) ?? null)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    try {
      await updateTask.mutateAsync({
        id: task.id,
        boardId,
        title: trimmedTitle,
        description: description.trim() || null,
        priority,
        assigneeId: effectiveAssigneeId,
        dueDate: dueDate || null,
      });
      onClose();
    } catch (err) {
      setSaveError(getErrorMessage(err as TasksError));
    }
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteTask.mutateAsync({ taskId: task.id, boardId });
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      setShowDeleteConfirm(false);
      setSaveError(getErrorMessage(err as TasksError));
    }
  };

  const isSaving = updateTask.isPending;
  const isDeleting = deleteTask.isPending;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-modal-title"
      >
        <div
          className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="edit-modal-title"
            className="mb-5 text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            Edit task
          </h2>

          {saveError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              {saveError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Title */}
            <div>
              <label
                htmlFor="edit-task-title"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Title
              </label>
              <input
                id="edit-task-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isSaving}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400 dark:focus:bg-slate-700"
              />
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="edit-task-desc"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Description{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="edit-task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isSaving}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400 dark:focus:bg-slate-700"
              />
            </div>

            {/* Priority */}
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Priority
              </span>
              <div className="flex gap-2" role="group" aria-label="Task priority">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    disabled={isSaving}
                    aria-pressed={priority === opt.value}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-800 ${
                      priority === opt.value
                        ? PRIORITY_STYLES[opt.value]
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Assignee */}
            <div>
              <label
                htmlFor="edit-task-assignee"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Assignee{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <select
                id="edit-task-assignee"
                value={resolvedAssignee?.id ?? ""}
                onChange={(e) => setAssigneeId(e.target.value || null)}
                disabled={isSaving}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:bg-slate-700"
              >
                <option value="">Unassigned</option>
                {employees
                  .filter((e) => e.displayName !== null)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.displayName}
                    </option>
                  ))}
              </select>
              {/* M-2: deactivated assignee notice — explains why picker shows "Unassigned".
                  isAssigneeDeactivated is true when the stored UUID is not in the
                  active directory; effectiveAssigneeId resolves to null so the
                  submit payload will clear the deactivated assignee automatically. */}
              {isAssigneeDeactivated && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Previous assignee is no longer in the directory. Saving will clear the assignment.
                </p>
              )}
            </div>

            {/* Due Date */}
            <div>
              <label
                htmlFor="edit-task-due"
                className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Due date{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="edit-task-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={isSaving}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:bg-slate-700"
                />
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => setDueDate("")}
                    disabled={isSaving}
                    aria-label="Clear due date"
                    className="shrink-0 rounded-lg border border-slate-200 p-2.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Action row */}
            <div className="flex items-center justify-between gap-2 pt-2">
              {/* Delete — left-aligned, destructive */}
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSaving || isDeleting}
                className="rounded-lg border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Delete
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSaving}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
                >
                  {isSaving && (
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      aria-hidden
                    />
                  )}
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Delete confirmation — reuses the Teams ConfirmDialog (FE-T-2) */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete this task?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isPending={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}

/**
 * EditModal — outer wrapper that conditionally renders EditForm.
 *
 * Uses key={task.id} on EditForm so that React remounts the inner form
 * whenever a different task is selected. This ensures useState initializers
 * in EditForm re-run for the new task without needing setState-in-effect.
 */
export default function EditModal({ task, boardId, onClose }: EditModalProps) {
  if (!task) return null;

  return <EditForm key={task.id} task={task} boardId={boardId} onClose={onClose} />;
}
