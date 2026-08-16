import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Employees | Kanban",
  description: "Manage your company employees — invite, promote, and deactivate.",
};

export default function EmployeesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
