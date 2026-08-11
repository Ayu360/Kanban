"use client";

/**
 * TeamsEmptyState — shown when the authenticated user has no visible teams.
 *
 * Renders different copy for employees (no team memberships) vs admins
 * (no teams in company yet). Admins see a prompt to create their first team.
 */

interface TeamsEmptyStateProps {
  isAdmin: boolean;
  onCreateTeam?: () => void;
}

export default function TeamsEmptyState({
  isAdmin,
  onCreateTeam,
}: TeamsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      {/* Icon */}
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
        <svg
          className="h-8 w-8 text-slate-400 dark:text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </div>

      {isAdmin ? (
        <>
          <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">
            No teams yet
          </h2>
          <p className="mb-6 max-w-xs text-sm text-slate-500 dark:text-slate-400">
            Create your first team to start organizing employees and their boards.
          </p>
          {onCreateTeam && (
            <button
              type="button"
              onClick={onCreateTeam}
              className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
            >
              Create your first team
            </button>
          )}
        </>
      ) : (
        <>
          <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">
            No teams yet
          </h2>
          <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
            You are not a member of any teams. Contact your company admin to be
            added to a team.
          </p>
        </>
      )}
    </div>
  );
}
