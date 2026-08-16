"use client";

import KanbanHeader from "@/features/kanban/components/KanbanHeader";
import EmployeesPageContent from "@/features/employees/components/EmployeesPageContent";

/**
 * /employees — Employee management page.
 *
 * Auth enforcement is handled entirely by middleware (src/middleware.ts).
 * This page does NOT perform useEffect-based auth redirect guards (ADR-0011).
 *
 * Admin UI: full management list with invite / promote / deactivate controls.
 * Non-admin view: EmployeesPageContent renders an "access restricted" state.
 *
 * Reuses the existing KanbanHeader for consistent app-shell chrome.
 */
export default function EmployeesPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <KanbanHeader />
      <main>
        <EmployeesPageContent />
      </main>
    </div>
  );
}
