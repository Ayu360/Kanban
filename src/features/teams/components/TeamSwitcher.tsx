"use client";

/**
 * TeamSwitcher — dropdown trigger that lets the user jump between teams.
 *
 * Rendered in KanbanHeader when:
 *   - teams.length >= 2 (caller enforces this)
 *   - activeTeamId is non-null (caller enforces this)
 *
 * The trigger label IS the active-team indicator (no separate subtitle needed).
 * aria-label on the trigger covers the context that the visible text alone
 * doesn't convey for screen readers.
 *
 * Dropdown pattern matches the existing user-menu in KanbanHeader:
 *   - Fixed backdrop div handles click-outside dismiss
 *   - Escape key closes the dropdown
 *   - role="menu" + role="menuitem" for accessibility
 *
 * onOpenChange is called with `false` when the switcher closes so the parent
 * (KanbanHeader) can coordinate other open dropdowns.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Team } from "../types";

interface TeamSwitcherProps {
  teams: Team[];
  activeTeamId: string;
  onOpenChange?: (open: boolean) => void;
}

export default function TeamSwitcher({
  teams,
  activeTeamId,
  onOpenChange,
}: TeamSwitcherProps) {
  const [open, setOpen] = useState(false);

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const otherTeams = teams.filter((t) => t.id !== activeTeamId);
  const teamName = activeTeam?.name ?? "Team";

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
  }, [open, onOpenChange]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Current team: ${teamName}. Switch team.`}
        className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <span className="max-w-[80px] truncate">{teamName}</span>
        <svg
          className="h-3.5 w-3.5 shrink-0 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <>
          {/* Click-outside backdrop — same pattern as user menu */}
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={close}
          />
          <div
            role="menu"
            aria-label="Switch team"
            className="absolute left-0 top-full z-20 mt-2 min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
          >
            {otherTeams.length === 0 ? (
              <p className="px-4 py-2.5 text-sm text-slate-400 dark:text-slate-500">
                No other teams
              </p>
            ) : (
              otherTeams.map((team) => (
                <Link
                  key={team.id}
                  href={`/teams/${team.id}/board`}
                  role="menuitem"
                  onClick={close}
                  className="block truncate px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {team.name}
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
