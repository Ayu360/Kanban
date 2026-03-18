"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import type { RootState } from "@/store";

export default function Home() {
  const router = useRouter();
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);

  useEffect(() => {
    if (currentUser) {
      router.replace("/kanban");
    } else {
      router.replace("/login");
    }
  }, [currentUser, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-900">
      <p className="text-zinc-600 dark:text-zinc-400">Redirecting...</p>
    </div>
  );
}
