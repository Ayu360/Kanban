/**
 * Teams module shared constants.
 *
 * LAST_TEAM_KEY is the localStorage key that persists the user's last-visited
 * team so /kanban can redirect to their preferred board. Written on every
 * board mount by useRememberLastTeam and cleared on sign-out. Client-only.
 */
export const LAST_TEAM_KEY = "kanban:lastTeamId";
