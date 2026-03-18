"use client";

import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { store } from "@/store";
import { setUser, setStoredUserId } from "@/store/slices/authSlice";
import { getFakeUsers } from "@/lib/fakeApi";
import type { RootState } from "@/store";

type AppDispatch = typeof store.dispatch;

const AUTH_STORAGE_KEY = "kanban_current_user_id";

export function AuthHydration({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);
  const storedUserId = useSelector((state: RootState) => state.auth.storedUserId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = localStorage.getItem(AUTH_STORAGE_KEY);
    dispatch(setStoredUserId(id));
  }, [dispatch]);

  useEffect(() => {
    if (currentUser || !storedUserId) return;
    getFakeUsers().then((users) => {
      const user = users.find((u) => u.id === storedUserId);
      if (user) dispatch(setUser(user));
    });
  }, [storedUserId, currentUser, dispatch]);

  return <>{children}</>;
}
