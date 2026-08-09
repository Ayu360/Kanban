import type { Metadata } from "next";

/**
 * Auth route group layout.
 *
 * Shared by /signup, /reset-password, and /reset-password/confirm.
 * Minimal layout — no sidebar, no main-app navigation.
 * The /login page uses its own layout (src/app/login/layout.tsx) which
 * follows the same minimal pattern.
 */
export const metadata: Metadata = {
  title: "Kanban",
};

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
