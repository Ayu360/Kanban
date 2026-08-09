"use client";

import React, { useTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updatePasswordAction } from "@/features/auth/services/authActions";

/**
 * Password reset confirmation page.
 *
 * The user lands here after clicking the reset link in their email. The link
 * goes to /api/auth/callback?code=<code>&next=/reset-password/confirm which
 * exchanges the PKCE code for a session server-side (via the route handler)
 * and then redirects here. By the time this page renders, the session is
 * already valid.
 *
 * This page MUST NOT call supabase.auth.exchangeCodeForSession() — that is
 * handled by /api/auth/callback. Any client-side code-exchange attempt would
 * conflict with the route handler and break the flow.
 *
 * On success: redirect to /login with a success message in state.
 * On failure (token expired, already used): display the error and prompt the
 * user to request a new reset email.
 */
export default function ResetPasswordConfirmPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMismatch, setPasswordMismatch] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setPasswordError(null);
    setPasswordMismatch(false);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    // Client-side UX validation only — the server also validates.
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }

    // Client-side mismatch check — both fields must match before submitting.
    if (password !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }

    // Only "password" is sent to the action — confirmPassword is UI-only.
    const actionData = new FormData();
    actionData.set("password", password);

    startTransition(async () => {
      const result = await updatePasswordAction(actionData);

      if (result.success) {
        // Redirect to login with a flag so the login page can show a
        // "Password updated" success message if desired.
        router.push("/login?passwordUpdated=1");
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Set new password
          </h1>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Choose a strong password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              disabled={isPending}
              placeholder="At least 8 characters"
              aria-describedby={passwordError ? "password-error" : "password-hint"}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
            {passwordError ? (
              <p id="password-error" role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                {passwordError}
              </p>
            ) : (
              <p id="password-hint" className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Minimum 8 characters.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              disabled={isPending}
              placeholder="Repeat your password"
              aria-describedby={passwordMismatch ? "confirm-error" : undefined}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
            />
            {passwordMismatch && (
              <p id="confirm-error" role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                Passwords don&apos;t match.
              </p>
            )}
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              <p className="mb-2">{errorMessage}</p>
              <p className="text-xs">
                Your reset link may have expired or already been used.{" "}
                <Link
                  href="/reset-password"
                  className="font-medium underline hover:no-underline"
                >
                  Request a new one.
                </Link>
              </p>
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
                Updating password...
              </>
            ) : (
              "Update password"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          <Link
            href="/login"
            className="font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
