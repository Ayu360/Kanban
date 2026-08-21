import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Board | Kanban",
  description: "Manage your team's tasks with a visual Kanban board.",
};

export default function TeamBoardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
