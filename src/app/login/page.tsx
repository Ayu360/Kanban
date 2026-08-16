"use client";

import React, { Suspense, useTransition, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { signInAction } from "@/features/auth/services/authActions";
import { authQueryKeys } from "@/features/auth/hooks/useCurrentUser";

/**
 * Inner client component that reads useSearchParams().
 *
 * Extracted so that LoginPage can wrap it in a <Suspense> boundary, which is
 * required by the Next.js App Router whenever useSearchParams() is called in a
 * Client Component. Without this boundary the build emits a static-generation
 * bailout warning and the page cannot be statically optimised.
 *
 * All login behaviour is preserved here:
 * - reads ?redirect= query param and passes it as a hidden "redirectTo" input
 * - calls signInAction on submit
 * - invalidates the TanStack Query profile cache on success
 * - redirects to result.data.redirectTo on success
 * - renders inline error with role="alert" on failure
 * - disables inputs while the Server Action is in flight (useTransition)
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const redirectTo = searchParams.get("redirect") ?? "/kanban";

  // Middleware-injected status errors — shown above the login form.
  // 'deactivated' — admin blocked the account.
  // 'pending'     — invited user tried to access the app before accepting.
  // Unrecognized values are silently ignored (no message shown).
  const statusError = searchParams.get("error");
  const statusErrorMessage =
    statusError === "deactivated"
      ? "Your account has been deactivated. Please contact your administrator."
      : statusError === "pending"
        ? "Your invitation is pending. Please check your email to complete account setup."
        : null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await signInAction(formData);

      if (result.success) {
        // Invalidate the profile cache so useCurrentUser() reflects the new session.
        await queryClient.invalidateQueries({ queryKey: authQueryKeys.profile });
        router.push(result.data.redirectTo);
      } else {
        setErrorMessage(result.error.message);
      }
    });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-900">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Welcome back
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Sign in to your Kanban account
          </p>
        </div>

        {/* Middleware-injected status error — shown before the login form */}
        {statusErrorMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          >
            {statusErrorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={isPending}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Password
              </label>
              <Link
                href="/reset-password"
                className="text-xs font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isPending}
              placeholder="Enter your password"
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
          >
            {isPending ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Login page — exported default as required by Next.js App Router.
 *
 * Wraps <LoginForm> in a <Suspense> boundary so that useSearchParams() inside
 * LoginForm satisfies the Next.js App Router contract. Without this boundary,
 * the build emits a static-generation bailout and the page opts out of static
 * optimisation unnecessarily.
 *
 * The fallback matches the page's own full-screen centred layout so there is
 * no layout shift between the loading and loaded states.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-900">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
            aria-label="Loading"
          />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
