"use client";

/**
 * InviteEmployeeModal — invite a new employee by email address.
 *
 * Uses useInviteEmployee() mutation.
 * On success: closes the modal (parent re-fetches via query invalidation).
 * On CONFLICT: shows a specific "already invited" message.
 * On other errors: shows the backend message verbatim.
 *
 * Accessibility:
 *   - role="dialog" aria-modal="true" aria-labelledby
 *   - Error alert has role="alert"
 *   - Escape key closes when not pending
 *   - useFocusTrap handles: initial focus, Tab/Shift+Tab trap, trigger restore
 */

import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/features/teams/hooks/useFocusTrap";
import { useInviteEmployee } from "../hooks/useInviteEmployee";

interface InviteEmployeeModalProps {
  onClose: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteEmployeeModal({ onClose }: InviteEmployeeModalProps) {
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Always mounted when visible, so isOpen is always true here.
  const containerRef = useFocusTrap(true);

  const invite = useInviteEmployee();

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
      if (e.key === "Escape" && !invite.isPending) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [invite.isPending, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);

    const trimmed = email.trim();

    if (!trimmed) {
      setLocalError("Email address is required.");
      inputRef.current?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setLocalError("Please enter a valid email address.");
      inputRef.current?.focus();
      return;
    }

    const result = await invite.mutateAsync({ email: trimmed });

    if (result.success) {
      setSuccessMessage(`Invitation sent to ${trimmed}.`);
      // Close after a brief moment so the success message is readable.
      setTimeout(() => onClose(), 1200);
      return;
    }

    // Surface backend errors verbatim. CONFLICT message from the backend
    // already reads "An invitation has already been sent to this email address."
    setLocalError(result.error.message);
    inputRef.current?.focus();
  };

  const displayedError = localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={invite.isPending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-employee-title"
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <h2
          id="invite-employee-title"
          className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Invite employee
        </h2>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
          Enter an email address to send an invitation. The employee will receive
          a link to set their password and join your company.
        </p>

        {successMessage && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
          >
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="invite-email-input"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Email address
            </label>
            <input
              ref={inputRef}
              id="invite-email-input"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setLocalError(null);
              }}
              placeholder="alice@example.com"
              autoComplete="email"
              disabled={invite.isPending || !!successMessage}
              aria-describedby={displayedError ? "invite-email-error" : undefined}
              aria-invalid={!!displayedError}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
            {displayedError && (
              <p
                id="invite-email-error"
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
              disabled={invite.isPending}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={invite.isPending || !!successMessage}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
            >
              {invite.isPending && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
              )}
              {invite.isPending ? "Sending..." : "Send invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
