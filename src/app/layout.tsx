import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./Providers";
import AppFooter from "@/components/AppFooter";

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (typeof process.env.VERCEL_URL === "string"
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "Kanban Demo",
  description: "Kanban board with TanStack Query and Redux",
  icons: {
    icon: "/assets/logo.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <div className="min-h-0 flex-1">
          <Providers>{children}</Providers>
        </div>
        <AppFooter />
      </body>
    </html>
  );
}
