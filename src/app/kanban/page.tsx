"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTeams } from "@/features/teams/hooks/useTeams";
import KanbanHeader from "@/features/kanban/components/KanbanHeader";

/**
 * /kanban — legacy convenience route.
 *
 * Redirects to the user's first team's board at /teams/[teamId]/board.
 * The canonical board URL is /teams/[teamId]/board.
 *
 * If the user has no teams yet, shows a placeholder directing them to
 * the teams page to create or join a team.
 *
 * Auth enforcement is handled entirely by middleware (src/middleware.ts).
 */
export default function KanbanPage() {
  const router = useRouter();
  const { teams, isLoading } = useTeams();

  useEffect(() => {
    if (isLoading) return;
    if (teams.length > 0) {
      // Redirect to the first team's board. Replace so the user cannot
      // navigate back to this route with the back button.
      router.replace(`/teams/${teams[0].id}/board`);
    }
    // If no teams: fall through and render the placeholder below.
  }, [isLoading, teams, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Redirecting to your board...
          </p>
        </div>
      </div>
    );
  }

  // User has at least one team — redirect is in progress via useEffect.
  if (teams.length > 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Redirecting to your board...
          </p>
        </div>
      </div>
    );
  }

  // No teams — show a helpful placeholder.
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <KanbanHeader />
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <svg
            className="h-6 w-6 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <div>
          <p className="text-base font-medium text-slate-900 dark:text-slate-100">
            No team board yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            You are not a member of any team. Ask an admin to add you to a team,
            or create one from the Teams page.
          </p>
        </div>
        <Link
          href="/teams"
          className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
        >
          Go to Teams
        </Link>
      </div>
    </div>
  );
}
