import { redirect } from "next/navigation";

/**
 * Root page — unconditionally redirects to /kanban.
 *
 * Middleware (src/middleware.ts) handles the actual auth enforcement:
 * - Unauthenticated users hitting /kanban are redirected to /login.
 * - Authenticated users hitting /login are redirected to /kanban.
 *
 * This Server Component does not perform auth checks itself (ADR-0011).
 * It simply provides the entry-point redirect so the root path "/" is not a
 * dead end.
 */
export default function Home() {
  redirect("/kanban");
}
