import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team | Kanban",
  description: "View and manage team members.",
};

export default function TeamDetailLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
