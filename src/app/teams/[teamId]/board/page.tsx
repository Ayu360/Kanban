"use client";

import { use } from "react";
import { useBoardIdByTeam } from "@/features/tasks/hooks/useBoardIdByTeam";
import KanbanDashBoard from "@/features/kanban";
import KanbanHeader from "@/features/kanban/components/KanbanHeader";

/**
 * /teams/[teamId]/board — Team Kanban board page.
 *
 * Auth enforcement is handled entirely by middleware (src/middleware.ts).
 * This page does NOT perform useEffect-based auth redirect guards (ADR-0011).
 *
 * Resolution flow:
 *   1. Extract teamId from URL params.
 *   2. useBoardIdByTeam resolves the boardId for the team via a direct
 *      SELECT on the boards table (RLS: caller must be a team member).
 *   3. Pass boardId to KanbanDashBoard which calls useBoard(boardId).
 *
 * Access denial:
 *   - If the user is not a team member, RLS returns no rows → boardId is null
 *     → KanbanDashBoard renders the "no access" state.
 *   - Per PRD FR-09: show "You do not have access to this board."
 */
export default function TeamBoardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = use(params);
  const { boardId, isLoading, error } = useBoardIdByTeam(teamId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading board...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Failed to load board.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Try refreshing the page.
          </p>
        </div>
      </div>
    );
  }

  if (!boardId) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <KanbanHeader />
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            You do not have access to this board.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You must be a member of this team to view its board.
          </p>
        </div>
      </div>
    );
  }

  return <KanbanDashBoard boardId={boardId} />;
}
