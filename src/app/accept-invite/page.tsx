"use client";

/**
 * /accept-invite — Invite acceptance callback page.
 *
 * Flow:
 *   1. Supabase Auth has already established a session (the invited user clicked
 *      the magic link and set their password via the Auth UI).
 *   2. On mount, calls useActivateInvitedEmployee().mutate() to transition the
 *      profile from 'pending' → 'active'.
 *   3. On success: redirect to /kanban (the default post-login destination).
 *   4. On FORBIDDEN with deactivated context: show an error — the account was
 *      deactivated between invite and acceptance.
 *   5. On any other error: show a retry prompt.
 *
 * Middleware note: /accept-invite is in PENDING_ALLOWED_PATHS — pending users
 * are explicitly allowed on this path. Do not modify middleware.
 *
 * The eslint-disable below is intentional — the dependency array is [] by design:
 * the activate call should run exactly once on mount, not re-run on every render.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useActivateInvitedEmployee } from "@/features/employees/hooks/useActivateInvitedEmployee";

type PageState = "activating" | "success" | "deactivated" | "error";

export default function AcceptInvitePage() {
  const router = useRouter();
  const activate = useActivateInvitedEmployee();
  const [pageState, setPageState] = useState<PageState>("activating");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Run exactly once on mount — mutateAsync is stable across renders.
    activate.mutate(undefined, {
      onSuccess: (result) => {
        if (result.success) {
          setPageState("success");
          // Brief delay so the success message is readable before redirect.
          setTimeout(() => {
            router.replace("/kanban");
          }, 800);
          return;
        }

        // Check for deactivated-account error (FORBIDDEN + deactivated context).
        if (result.error.code === "FORBIDDEN") {
          setPageState("deactivated");
          setErrorMessage(
            "Your account has been deactivated. Contact your administrator."
          );
        } else {
          setPageState("error");
          setErrorMessage(result.error.message);
        }
      },
      onError: () => {
        setPageState("error");
        setErrorMessage(
          "Something went wrong while activating your account. Please try again."
        );
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-900">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500 text-white shadow-lg">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
          </div>
        </div>

        {/* Activating */}
        {pageState === "activating" && (
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Setting up your account...
            </p>
          </div>
        )}

        {/* Success */}
        {pageState === "success" && (
          <div role="status" className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
              <svg
                className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Account activated!
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Redirecting you to the app...
            </p>
          </div>
        )}

        {/* Deactivated error */}
        {pageState === "deactivated" && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-center dark:border-red-800 dark:bg-red-900/20"
          >
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              Account deactivated
            </p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          </div>
        )}

        {/* Generic error */}
        {pageState === "error" && (
          <div className="flex flex-col items-center gap-4">
            <div
              role="alert"
              className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              {errorMessage}
            </div>
            <button
              type="button"
              onClick={() => {
                setPageState("activating");
                setErrorMessage(null);
                activate.mutate(undefined, {
                  onSuccess: (result) => {
                    if (result.success) {
                      setPageState("success");
                      setTimeout(() => router.replace("/kanban"), 800);
                    } else if (result.error.code === "FORBIDDEN") {
                      setPageState("deactivated");
                      setErrorMessage(
                        "Your account has been deactivated. Contact your administrator."
                      );
                    } else {
                      setPageState("error");
                      setErrorMessage(result.error.message);
                    }
                  },
                  onError: () => {
                    setPageState("error");
                    setErrorMessage(
                      "Something went wrong while activating your account. Please try again."
                    );
                  },
                });
              }}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
