import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it Works | Kanban",
  description: "Learn how to use the Kanban board with this visual guide. No login required.",
};

export default function HowItWorksLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
