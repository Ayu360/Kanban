"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { store } from "@/store";
import { setSearchQuery } from "@/store/slices/uiSlice";
import { setUser, clearUser } from "@/store/slices/authSlice";
import type { RootState } from "@/store";
import { getFakeUsers } from "@/lib/fakeApi";
import type { User } from "@/features/kanban/types";

type AppDispatch = typeof store.dispatch;

const SEARCH_DEBOUNCE_MS = 300;

const KanbanHeader = () => {
  const dispatch = useDispatch<AppDispatch>();
  const searchQuery = useSelector((state: RootState) => state.ui.searchQuery);
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [userSwitcherOpen, setUserSwitcherOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    getFakeUsers().then(setUsers);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      dispatch(setSearchQuery(searchInput));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput, dispatch]);

  const handleUserSelect = useCallback(
    (user: User) => {
      dispatch(setUser(user));
      setUserSwitcherOpen(false);
    },
    [dispatch]
  );

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/kanban" className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sky-500 text-white shadow-sm sm:h-9 sm:w-9">
              <img src="/assets/logo.png" alt="" className="h-4 w-4 object-contain sm:h-5 sm:w-5" aria-hidden />
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-xl">
              Kanban
            </h1>
          </Link>
          <Link
            href="/how-it-works"
            className="hidden text-sm font-medium text-slate-600 underline underline-offset-2 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 sm:block"
          >
            How it works
          </Link>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:gap-3">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-initial">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 sm:left-3">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="search"
              placeholder="Search tasks..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400 dark:focus:bg-slate-800 sm:pl-9"
            />
          </div>
          {currentUser && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setUserSwitcherOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:gap-2 sm:px-3"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-medium leading-none text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
                  {currentUser.name.charAt(0)}
                </span>
                <span className="hidden max-w-[80px] truncate sm:inline">{currentUser.name}</span>
                <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {userSwitcherOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    aria-hidden
                    onClick={() => setUserSwitcherOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-20 mt-2 min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                    {users.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => handleUserSelect(user)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {user.name.charAt(0)}
                        </span>
                        {user.name}
                      </button>
                    ))}
                    <div className="my-1 border-t border-slate-200 dark:border-slate-600" />
                    <button
                      type="button"
                      onClick={() => {
                        dispatch(clearUser());
                        setUserSwitcherOpen(false);
                        window.location.href = "/login";
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Log out
                    </button>
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
