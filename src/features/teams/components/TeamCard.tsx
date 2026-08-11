"use client";

/**
 * TeamCard — a single team row/card in the teams list.
 *
 * Admin view: shows team name, member count, board link, rename and delete actions.
 * Employee view: read-only — team name and a "Go to board" link.
 *
 * Admin controls are UX-only gates. Authorization is enforced by the backend.
 */

import Link from "next/link";

interface TeamCardProps {
  teamId: string;
  teamName: string;
  memberCount: number;
  isAdmin: boolean;
  isDeletePending?: boolean;
  onRename: () => void;
  onDelete: () => void;
}

export default function TeamCard({
  teamId,
  teamName,
  memberCount,
  isAdmin,
  isDeletePending = false,
  onRename,
  onDelete,
}: TeamCardProps) {
  return (
    <div className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600">
      {/* Left: Name + meta */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/teams/${teamId}`}
          className="block truncate text-base font-semibold text-slate-900 transition hover:text-sky-600 dark:text-slate-100 dark:hover:text-sky-400"
        >
          {teamName}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {memberCount === 1 ? "1 member" : `${memberCount} members`}
        </p>
      </div>

      {/* Right: Actions */}
      <div className="ml-4 flex shrink-0 items-center gap-2">
        {/* Board link — always visible */}
        <Link
          href={`/teams/${teamId}`}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          View team
        </Link>

        {/* Admin-only controls */}
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={onRename}
              disabled={isDeletePending}
              aria-label={`Rename team ${teamName}`}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-sky-600 dark:hover:bg-sky-900/20 dark:hover:text-sky-400"
            >
              {/* Pencil icon */}
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
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeletePending}
              aria-label={`Delete team ${teamName}`}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              {isDeletePending ? (
                <span
                  className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-red-500"
                  aria-hidden
                />
              ) : (
                /* Trash icon */
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
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
