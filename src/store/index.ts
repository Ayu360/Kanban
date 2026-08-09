import { configureStore } from "@reduxjs/toolkit";
import uiReducer from "./slices/uiSlice";

/**
 * Redux store — UI state only.
 *
 * ADR-0005, ADR-0012: Auth session is NOT stored here. It lives in Supabase
 * Auth (HTTP-only cookies) and is accessed via useCurrentUser() (TanStack Query).
 * The previous authSlice has been removed as part of the Supabase Auth migration.
 */
export const store = configureStore({
  reducer: {
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
