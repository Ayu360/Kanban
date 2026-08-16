import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accept Invitation | Kanban",
  description: "Complete your account setup.",
};

export default function AcceptInviteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
