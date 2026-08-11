"use client";

import KanbanHeader from "@/features/kanban/components/KanbanHeader";
import TeamsPageContent from "@/features/teams/components/TeamsPageContent";

/**
 * /teams — Teams list page.
 *
 * Auth enforcement is handled entirely by middleware (src/middleware.ts).
 * This page does NOT perform useEffect-based auth redirect guards (ADR-0011).
 *
 * Reuses the existing KanbanHeader for consistent app-shell chrome.
 */
export default function TeamsPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <KanbanHeader />
      <main>
        <TeamsPageContent />
      </main>
    </div>
  );
}
