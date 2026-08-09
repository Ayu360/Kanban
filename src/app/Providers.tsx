"use client";

import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { store } from "@/store";

/**
 * Application providers.
 *
 * ADR-0012: AuthHydration has been removed. Auth session is now managed by
 * Supabase Auth via HTTP-only cookies and enforced by Next.js middleware.
 * Components that need the current user call useCurrentUser() which is backed
 * by TanStack Query (query key: ['auth', 'profile']).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </Provider>
  );
}
