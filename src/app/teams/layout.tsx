import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Teams | Kanban",
  description: "Manage your company teams and their members.",
};

export default function TeamsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
