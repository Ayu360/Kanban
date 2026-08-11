"use client";

import { use } from "react";
import KanbanHeader from "@/features/kanban/components/KanbanHeader";
import TeamDetailContent from "@/features/teams/components/TeamDetailContent";

/**
 * /teams/[teamId] — Team detail page.
 *
 * Auth enforcement is handled entirely by middleware (src/middleware.ts).
 * This page does NOT perform useEffect-based auth redirect guards (ADR-0011).
 *
 * Reuses the existing KanbanHeader for consistent app-shell chrome.
 * teamId is extracted from the params Promise via React 19's `use()`.
 */
export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = use(params);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <KanbanHeader />
      <main>
        <TeamDetailContent teamId={teamId} />
      </main>
    </div>
  );
}
