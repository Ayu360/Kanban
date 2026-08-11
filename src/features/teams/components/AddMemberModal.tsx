"use client";

/**
 * AddMemberModal — Add an employee to a team by Profile ID.
 *
 * NOTE: The Employees module (03-employees.md) has not yet been implemented.
 * When it is available, this component should be upgraded to show a searchable
 * employee picker that lists company employees by display name. Until then, the
 * admin enters a Profile UUID directly. This is an intentional interim state.
 * See docs/handoffs/frontend-to-reviewer-teams.md for the full note.
 *
 * The backend validates:
 *   - That the profileId is a valid UUID (VALIDATION_ERROR)
 *   - That the profile belongs to the same company as the team (CROSS_COMPANY)
 *   - That the team exists (NOT_FOUND)
 *
 * Accessibility:
 *   - role="dialog" aria-modal, escape key, error alerts
 *   - useFocusTrap handles: initial focus, Tab/Shift+Tab trap, trigger restore
 */

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface AddMemberModalProps {
  teamId: string;
  isPending: boolean;
  errorMessage: string | null;
  onSubmit: (profileId: string) => void;
  onClose: () => void;
}

export default function AddMemberModal({
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: AddMemberModalProps) {
  const [profileId, setProfileId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // AddMemberModal is always mounted when visible, so isOpen is always true here.
  const containerRef = useFocusTrap(true);

  // Lock scroll on mount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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
    const trimmed = profileId.trim();

    if (!trimmed) {
      setLocalError("Profile ID is required.");
      inputRef.current?.focus();
      return;
    }

    // Basic UUID format check (UX only — backend validates authoritatively).
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(trimmed)) {
      setLocalError("Please enter a valid Profile ID (UUID format).");
      inputRef.current?.focus();
      return;
    }

    onSubmit(trimmed);
  };

  const displayedError = errorMessage ?? localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={isPending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-member-title"
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <h2
          id="add-member-title"
          className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Add member
        </h2>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
          Enter the employee&apos;s Profile ID to add them to this team. An employee
          picker will be available once the Employees module is implemented.
        </p>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="profile-id-input"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Profile ID
            </label>
            <input
              ref={inputRef}
              id="profile-id-input"
              type="text"
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setLocalError(null);
              }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              disabled={isPending}
              aria-describedby={displayedError ? "profile-id-error" : undefined}
              aria-invalid={!!displayedError}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
            {displayedError && (
              <p
                id="profile-id-error"
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
              {isPending ? "Adding..." : "Add member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
