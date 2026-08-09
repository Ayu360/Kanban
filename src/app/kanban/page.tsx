"use client";

import KanbanDashBoard from "@/features/kanban";

/**
 * Kanban page — renders the board dashboard.
 *
 * Auth enforcement is handled entirely by middleware (src/middleware.ts).
 * This page does NOT perform useEffect-based auth redirect guards (ADR-0011).
 * If an unauthenticated user reaches this route, middleware will have already
 * redirected them to /login before this component renders.
 */
export default function KanbanPage() {
  return <KanbanDashBoard />;
}
