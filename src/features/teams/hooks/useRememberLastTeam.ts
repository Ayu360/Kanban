"use client";

/**
 * useRememberLastTeam — persists the last visited team board to localStorage.
 *
 * Mount on the board page. Fires on every board mount so localStorage stays
 * fresh even when the user navigates across multiple teams' boards in a session.
 *
 * The stored key is "kanban:lastTeamId". Read by /kanban to redirect returning
 * users to their most recently visited board.
 *
 * No server persistence — localStorage only (PRD decision).
 */

import { useEffect } from "react";
import { LAST_TEAM_KEY } from "../constants";

export function useRememberLastTeam(teamId: string): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!teamId) return;
    localStorage.setItem(LAST_TEAM_KEY, teamId);
  }, [teamId]);
}
