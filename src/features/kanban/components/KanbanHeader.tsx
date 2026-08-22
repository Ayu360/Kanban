"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { useFormStatus } from "react-dom";
import { store } from "@/store";
import { setSearchQuery } from "@/store/slices/uiSlice";
import type { RootState } from "@/store";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { signOutAction } from "@/features/auth/services/authActions";
import { LAST_TEAM_KEY } from "@/features/teams/constants";

type AppDispatch = typeof store.dispatch;

const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// LogoutButton — must be a child of <form> to use useFormStatus.
// Shows pending state while the Server Action is in-flight.
// ---------------------------------------------------------------------------

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      role="menuitem"
      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-900/20"
    >
      {pending ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-red-600 dark:border-red-700 dark:border-t-red-400"
          aria-hidden
        />
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      )}
      {pending ? "Signing out..." : "Log out"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// KanbanHeader
// ---------------------------------------------------------------------------

const KanbanHeader = () => {
  const dispatch = useDispatch<AppDispatch>();
  const searchQuery = useSelector((state: RootState) => state.ui.searchQuery);
  const { user } = useCurrentUser();
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [menuOpen, setMenuOpen] = useState(false);
  const [burgerOpen, setBurgerOpen] = useState(false);
  const pathname = usePathname();

  // L-2: Determine which nav link is the current page section.
  const isTeamsActive = pathname.startsWith("/teams");
  const isEmployeesActive = pathname.startsWith("/employees");

  // Admin check for the Employees nav link (UX-only gate — backend authorizes).
  const isAdmin = !!user && (user.role === "admin" || user.isPlatformAdmin);

  // Fix 3: Only show the search bar on pages where task search is relevant.
  const showSearch =
    pathname === "/kanban" || /^\/teams\/[^/]+\/board$/.test(pathname);

  useEffect(() => {
    const id = setTimeout(() => {
      dispatch(setSearchQuery(searchInput));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput, dispatch]);

  // ---------------------------------------------------------------------------
  // Dropdown coordination — only one open at a time.
  // ---------------------------------------------------------------------------

  const handleMenuToggle = useCallback(() => {
    setBurgerOpen(false);
    setMenuOpen((o) => !o);
  }, []);

  const handleBurgerToggle = useCallback(() => {
    setMenuOpen(false);
    setBurgerOpen((o) => !o);
  }, []);

  // Close burger on Escape.
  useEffect(() => {
    if (!burgerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBurgerOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [burgerOpen]);

  const displayName = user?.displayName ?? user?.email ?? "Account";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-4">
          {/* Mobile burger button — visible only below sm breakpoint */}
          <div className="relative sm:hidden">
            <button
              type="button"
              onClick={handleBurgerToggle}
              aria-expanded={burgerOpen}
              aria-haspopup="true"
              aria-label="Navigation menu"
              className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {/* Hamburger icon */}
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {burgerOpen && (
              <>
                {/* Fixed backdrop — click-outside-dismiss */}
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden
                  onClick={() => setBurgerOpen(false)}
                />
                <div
                  role="menu"
                  aria-label="Navigation"
                  className="absolute left-0 top-full z-20 mt-2 min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
                >
                  <Link
                    href="/teams"
                    role="menuitem"
                    aria-current={isTeamsActive ? "page" : undefined}
                    onClick={() => setBurgerOpen(false)}
                    className="block px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Teams
                  </Link>
                  {isAdmin && (
                    <Link
                      href="/employees"
                      role="menuitem"
                      aria-current={isEmployeesActive ? "page" : undefined}
                      onClick={() => setBurgerOpen(false)}
                      className="block px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Employees
                    </Link>
                  )}
                  <Link
                    href="/how-it-works"
                    role="menuitem"
                    onClick={() => setBurgerOpen(false)}
                    className="block px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    How it works
                  </Link>
                </div>
              </>
            )}
          </div>

          <Link href="/kanban" className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sky-500 text-white shadow-sm sm:h-9 sm:w-9">
              <img src="/assets/logo.png" alt="" className="h-4 w-4 object-contain sm:h-5 sm:w-5" aria-hidden />
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-xl">
              Kanban
            </h1>
          </Link>
          {/* L-2: aria-current="page" marks the active nav link for screen readers */}
          <Link
            href="/teams"
            aria-current={isTeamsActive ? "page" : undefined}
            className="hidden text-sm font-medium text-slate-600 underline underline-offset-2 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 sm:block"
          >
            Teams
          </Link>
          {/* Employees link — admin-only (UX gate; backend authorizes authoritatively) */}
          {isAdmin && (
            <Link
              href="/employees"
              aria-current={isEmployeesActive ? "page" : undefined}
              className="hidden text-sm font-medium text-slate-600 underline underline-offset-2 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 sm:block"
            >
              Employees
            </Link>
          )}
          <Link
            href="/how-it-works"
            className="hidden text-sm font-medium text-slate-600 underline underline-offset-2 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 sm:block"
          >
            How it works
          </Link>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:gap-3">
          {/* Fix 3: Search only on board pages */}
          {showSearch && (
            <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-initial">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 sm:left-3">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="search"
                placeholder="Search tasks..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search tasks"
                className="w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400 dark:focus:bg-slate-800 sm:pl-9"
              />
            </div>
          )}
          {user && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={handleMenuToggle}
                aria-expanded={menuOpen}
                aria-haspopup="true"
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:gap-2 sm:px-3"
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-medium leading-none text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
                  aria-hidden
                >
                  {initials}
                </span>
                <span className="hidden max-w-[80px] truncate sm:inline">{displayName}</span>
                <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-20 mt-2 min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
                  >
                    <div className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      {user.email}
                    </div>
                    <div className="border-t border-slate-200 dark:border-slate-600" />
                    {/* LogoutButton uses useFormStatus for pending state.
                        onSubmit clears localStorage before the Server Action fires. */}
                    <form
                      action={signOutAction}
                      onSubmit={() => {
                        if (typeof window !== "undefined") {
                          localStorage.removeItem(LAST_TEAM_KEY);
                        }
                      }}
                    >
                      <LogoutButton />
                    </form>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default KanbanHeader;
