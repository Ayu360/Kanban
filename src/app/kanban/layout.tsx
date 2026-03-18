import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kanban Board | Task Management Dashboard",
  description:
    "Manage your tasks with a clean, visual Kanban board. Drag and drop cards across To Do, In Progress, and Done columns. Search tasks, switch users, and track development progress in one place.",
  openGraph: {
    title: "Kanban Board | Task Management Dashboard",
    description:
      "Manage your tasks with a clean, visual Kanban board. Drag and drop cards across To Do, In Progress, and Done columns. Search tasks and track progress.",
    images: ["/assets/kanban.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kanban Board | Task Management Dashboard",
    description:
      "Manage your tasks with a visual Kanban board. Drag and drop across To Do, In Progress, and Done. Search and track progress.",
    images: ["/assets/kanban.png"],
  },
};

export default function KanbanLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
