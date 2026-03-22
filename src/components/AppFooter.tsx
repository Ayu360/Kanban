import Link from "next/link";

export default function AppFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white/50 py-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-2 px-4 sm:flex-row sm:gap-6">
        <Link
          href="/how-it-works"
          className="text-sm font-medium text-slate-600 underline underline-offset-2 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400"
        >
          How it works
        </Link>
        <Link
          href="/login"
          className="text-sm font-medium text-slate-600 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400"
        >
          Login
        </Link>
      </div>
    </footer>
  );
}
