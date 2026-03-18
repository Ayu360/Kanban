"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { store } from "@/store";
import { setUser } from "@/store/slices/authSlice";
import { getFakeUsers } from "@/lib/fakeApi";
import type { User } from "@/features/kanban/types";
import type { RootState } from "@/store";

type AppDispatch = typeof store.dispatch;

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFakeUsers().then((list) => {
      setUsers(list);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (currentUser) router.replace("/kanban");
  }, [currentUser, router]);

  const handleSelectUser = (user: User) => {
    dispatch(setUser(user));
    router.push("/kanban");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-900">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Kanban
        </h1>
      </div>
      <p className="mb-8 text-center text-slate-600 dark:text-slate-400">
        Choose a user to continue
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => handleSelectUser(user)}
            className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-sky-300 hover:shadow-md dark:border-slate-600 dark:bg-slate-800 dark:hover:border-sky-500"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-lg font-semibold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
              {user.name.charAt(0)}
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {user.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
