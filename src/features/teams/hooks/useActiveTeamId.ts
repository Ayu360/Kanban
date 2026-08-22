"use client";

/**
 * useActiveTeamId — extracts the active teamId from the current pathname.
 *
 * Returns the teamId string for any route under /teams/[teamId]/*, or null
 * for all other routes (/teams, /employees, /how-it-works, /kanban, /login, etc.).
 *
 * Uses regex so it correctly handles all current and future sub-routes of
 * /teams/[teamId] without enumerating them.
 */

import { usePathname } from "next/navigation";

const TEAM_ROUTE_RE = /^\/teams\/([^/]+)(?:\/.*)?$/;

export function useActiveTeamId(): string | null {
  const pathname = usePathname();
  const match = TEAM_ROUTE_RE.exec(pathname);
  return match ? match[1] : null;
}
