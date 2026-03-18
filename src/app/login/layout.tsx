import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In | Kanban",
  description:
    "Choose your profile to continue. Sign in to access your Kanban board and manage tasks across To Do, In Progress, and Done.",
  openGraph: {
    title: "Sign In | Kanban",
    description:
      "Choose your profile to continue. Sign in to access your Kanban board and manage your tasks.",
    images: ["/assets/login.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sign In | Kanban",
    description:
      "Choose your profile to continue. Sign in to access your Kanban board.",
    images: ["/assets/login.png"],
  },
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
