"use client";

/**
 * TeamMemberRow — a single row in the team members list.
 *
 * Shows member display name, role badge, and (admin only) a remove button.
 * Remove triggers a confirmation pattern inline (not a separate dialog) for
 * speed, consistent with the compact list UX. A spinner replaces the button
 * while the mutation is pending to prevent duplicate submissions.
 *
 * Admin controls are UX-only. Authorization is enforced by the backend.
 */

interface TeamMemberRowProps {
  profileId: string;
  displayName: string | null;
  role: string | null;
  isAdmin: boolean;
  isRemovePending: boolean;
  onRemove: (profileId: string) => void;
}

export default function TeamMemberRow({
  profileId,
  displayName,
  role,
  isAdmin,
  isRemovePending,
  onRemove,
}: TeamMemberRowProps) {
  const name = displayName ?? "Unknown member";
  const initials = name.charAt(0).toUpperCase();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-700/50">
      {/* Avatar + name */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold leading-none text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {name}
          </p>
          {role && (
            <p className="truncate text-xs capitalize text-slate-500 dark:text-slate-400">
              {role}
            </p>
          )}
        </div>
      </div>

      {/* Admin-only: remove button */}
      {isAdmin && (
        <button
          type="button"
          onClick={() => onRemove(profileId)}
          disabled={isRemovePending}
          aria-label={`Remove ${name} from team`}
          className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-500 dark:hover:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        >
          {isRemovePending ? (
            <span
              className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-red-500"
              aria-hidden
            />
          ) : (
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
          )}
        </button>
      )}
    </div>
  );
}
