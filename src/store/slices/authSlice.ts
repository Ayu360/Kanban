import { createSlice } from "@reduxjs/toolkit";
import type { User } from "@/features/kanban/types";

const AUTH_STORAGE_KEY = "kanban_current_user_id";

function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

export const authSlice = createSlice({
  name: "auth",
  initialState: {
    currentUser: null as User | null,
    storedUserId: getStoredUserId(),
  },
  reducers: {
    setUser(state, action: { payload: User }) {
      state.currentUser = action.payload;
      if (typeof window !== "undefined") {
        localStorage.setItem(AUTH_STORAGE_KEY, action.payload.id);
      }
    },
    clearUser(state) {
      state.currentUser = null;
      if (typeof window !== "undefined") {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    },
    setStoredUserId(state, action: { payload: string | null }) {
      state.storedUserId = action.payload;
    },
  },
});

export const { setUser, clearUser, setStoredUserId } = authSlice.actions;
export default authSlice.reducer;
