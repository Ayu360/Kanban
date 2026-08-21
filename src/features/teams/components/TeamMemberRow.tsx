"use client";

/**
 * TeamMemberRow — a single row in the team members list.
 *
 * Handles two distinct rendering modes:
 *
 * 1. Live member (profileId !== null)
 *    Shows display name, role badge, and (admin only) a remove button.
 *    Calls onRemove(profileId) when the remove button is clicked.
 *
 * 2. Tombstone (profileId === null — schema migration 20260819000001)
 *    The employee who held this membership slot has been hard-deleted.
 *    Renders "[Deleted User]" with muted styling, a ghost avatar, and
 *    (admin only) a "Remove" action that calls onRemoveTombstone(memberRowId).
 *    Role badge, initials avatar, and the standard remove-member button are
 *    NOT shown for tombstone rows.
 *
 * Remove triggers a confirmation pattern inline (not a separate dialog) for
 * speed, consistent with the compact list UX. A spinner replaces the button
 * while the mutation is pending to prevent duplicate submissions.
 *
 * Admin controls are UX-only. Authorization is enforced by the backend.
 */

interface TeamMemberRowProps {
  /** Surrogate UUID PK of the team_members row. Always present. Used as React key
   *  and as the target ID for tombstone removal. */
  memberRowId: string;
  /** Profile ID. Null when the profile has been hard-deleted (tombstone row). */
  profileId: string | null;
  displayName: string | null;
  role: string | null;
  isAdmin: boolean;
  isRemovePending: boolean;
  /** Called to remove a live member. Receives profileId (guaranteed non-null). */
  onRemove: (profileId: string) => void;
  /** Called to remove a tombstone row. Receives memberRowId (surrogate PK). */
  onRemoveTombstone: (memberRowId: string) => void;
}

export default function TeamMemberRow({
  memberRowId,
  profileId,
  displayName,
  role,
  isAdmin,
  isRemovePending,
  onRemove,
  onRemoveTombstone,
}: TeamMemberRowProps) {
  const isTombstone = profileId === null;

  // -------------------------------------------------------------------------
  // Tombstone rendering
  // -------------------------------------------------------------------------
  if (isTombstone) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 opacity-60"
        aria-label="Deleted user membership slot"
      >
        {/* Ghost avatar + label */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Ghost avatar — gray background, question mark icon, no initials */}
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
            aria-hidden
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
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm italic text-slate-500 dark:text-slate-400">
              <span title="This member's account was deleted. Remove this row to clean up.">
                [Deleted User]
              </span>
            </p>
          </div>
        </div>

        {/* Admin-only: tombstone remove button */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => onRemoveTombstone(memberRowId)}
            disabled={isRemovePending}
            aria-label="Remove deleted user slot from team"
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

  // -------------------------------------------------------------------------
  // Live member rendering
  // -------------------------------------------------------------------------
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
