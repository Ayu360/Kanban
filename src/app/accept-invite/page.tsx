"use client";

/**
 * /accept-invite — Invite acceptance page.
 *
 * Flow:
 *   1. Page mounts without a server-established session. Supabase's admin
 *      inviteUserByEmail uses the implicit flow — tokens arrive as a URL hash
 *      fragment (#access_token=...&refresh_token=...&type=invite). @supabase/ssr's
 *      createBrowserClient defaults to flowType:'pkce' and IGNORES hash tokens
 *      entirely, so the mount effect parses the hash manually and calls
 *      supabase.auth.setSession() to establish the session, then strips the
 *      hash via history.replaceState. getUser() then confirms the session
 *      before the form renders. See the mount-effect comment for the full
 *      rationale — the global browser client stays PKCE (password reset needs it).
 *   2. Session check: if no session, show "invalid/expired link" state immediately.
 *   3. Show "Set up your account" form — collects the user's display name AND
 *      a new password. Display name is required because the AddMember picker
 *      (and any other consumer of the employee_directory view) filters out
 *      null-name entries; without a name here, newly-active users are invisible
 *      in the picker after acceptance.
 *   4. On submit:
 *      a. Client-side validate: name >= 2 chars (trimmed), password >= 8 chars, fields match.
 *      b. UPDATE public.profiles SET display_name = ? WHERE id = auth.uid()
 *         (authorized by profiles_update_own RLS + GRANT UPDATE(display_name)).
 *         Runs FIRST — idempotent, no side effect on failure. Retry is safe.
 *      c. supabase.auth.updateUser({ password }) — browser client, current session.
 *         On failure (e.g. weak password per Supabase policy): inline error, retry.
 *      d. On success: call activateInvitedEmployeeAction() to flip status pending→active.
 *      e. On activate success: redirect to /kanban.
 *   5. If activate fails AFTER password is set: show retry that calls activate only
 *      (do NOT re-prompt for password — the user already has one).
 *
 * Middleware note: /accept-invite is in PENDING_ALLOWED_PATHS — do not modify
 * middleware.ts.
 *
 * Password rule: min 8 characters — matches reset-password/confirm/page.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useActivateInvitedEmployee } from "@/features/employees/hooks/useActivateInvitedEmployee";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState =
  | "checking"       // Session check on mount — brief, no UI shown.
  | "no-session"     // No valid session — link is invalid or expired.
  | "form"           // Set-password form is active.
  | "submitting"     // updateUser() in flight.
  | "activating"     // Password set; activate mutation in flight.
  | "activate-error" // Password set but activate failed — retry activate only.
  | "deactivated"    // Account deactivated between invite and acceptance.
  | "refresh-error"  // Activate succeeded but refreshSession() failed — user must re-login.
  | "success";       // Activate succeeded — redirecting.

// ---------------------------------------------------------------------------
// Inline validation (single-use — not extracted; matches reset-password pattern)
// ---------------------------------------------------------------------------

function validatePassword(
  password: string,
  confirm: string
): { passwordError: string | null; mismatch: boolean } {
  if (password.length < 8) {
    return { passwordError: "Password must be at least 8 characters.", mismatch: false };
  }
  if (password !== confirm) {
    return { passwordError: null, mismatch: true };
  }
  return { passwordError: null, mismatch: false };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AcceptInvitePage() {
  const router = useRouter();
  const activate = useActivateInvitedEmployee();

  const [pageState, setPageState] = useState<PageState>("checking");
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [activateErrorMessage, setActivateErrorMessage] = useState<string | null>(null);

  // Focus refs — name input gets focus on mount; refs used for post-error focus.
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Session check on mount — determine whether a valid invite session exists.
  // getUser() validates the JWT server-side rather than trusting local storage alone.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        // --- Implicit-flow token ingestion ---
        //
        // @supabase/ssr's createBrowserClient defaults to flowType: 'pkce'.
        // In PKCE mode the SDK only looks for a ?code= query parameter and
        // ignores URL hash fragments entirely. Supabase's admin
        // inviteUserByEmail, however, uses the IMPLICIT flow — it places
        // tokens in the URL hash:
        //   #access_token=...&refresh_token=...&type=invite&expires_at=...
        //
        // Because we must not change the global browser client config
        // (password reset uses PKCE correctly and must not be disturbed), we
        // parse the hash manually here and hand the tokens to setSession() so
        // the SDK stores them exactly as it would for any other established
        // session. history.replaceState then strips the hash so a subsequent
        // browser refresh does not attempt to re-process a consumed one-time
        // link — the session will be re-established from the cookie instead.
        //
        // Note: the tokens remain visible in window.location.hash for the
        // async duration of setSession() (~50ms). This exposure window is
        // inherent to the implicit flow and cannot be shortened further short
        // of moving invites off implicit flow entirely.
        if (typeof window !== "undefined" && window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.slice(1));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");
          if (accessToken && refreshToken) {
            const { error: setError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (setError) {
              if (!cancelled) setPageState("no-session");
              return;
            }
            // Clean the URL — keep path and any query params, strip the hash.
            // This prevents the one-time tokens from lingering in browser
            // history and ensures a refresh re-establishes via cookie, not hash.
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search
            );
          }
        }
        // --- End implicit-flow token ingestion ---

        const { data: { user } } = await supabase.auth.getUser();
        if (!cancelled) {
          setPageState(user ? "form" : "no-session");
        }
      } catch {
        if (!cancelled) setPageState("no-session");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Focus the name input when the form becomes visible.
  useEffect(() => {
    if (pageState === "form") {
      // rAF so the element is in the DOM before we try to focus it.
      const frameId = requestAnimationFrame(() => nameRef.current?.focus());
      return () => cancelAnimationFrame(frameId);
    }
  }, [pageState]);

  // ---------------------------------------------------------------------------
  // Activate helper — shared between first attempt and retry.
  // ---------------------------------------------------------------------------

  function runActivate() {
    setPageState("activating");
    setActivateErrorMessage(null);

    activate.mutate(undefined, {
      onSuccess: async (result) => {
        if (result.success) {
          // Refresh the session so Supabase reissues the JWT. This triggers
          // custom_access_token_hook which reads the now-active profile status.
          // Without this, the browser-side JWT still carries status='pending'
          // and middleware would redirect the user back to /login?error=pending.
          const supabase = getSupabaseBrowserClient();
          let refreshFailed = false;
          try {
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) refreshFailed = true;
          } catch {
            // fetch-level rejection (offline, DNS failure). Handled identically
            // to a returned { error } — funnel into refresh-error state.
            refreshFailed = true;
          }

          if (refreshFailed) {
            // The session refresh failed. Redirecting to /kanban now would fail
            // the same way as the original bug — middleware would see the stale
            // JWT. Show a "re-login required" state so the user can click to
            // /login and get a fresh session from there. Safe: the account IS
            // active in the DB; they just need to sign in normally.
            setPageState("refresh-error");
            return;
          }

          setPageState("success");
          // Brief pause so the success message is readable before redirect.
          // The existing 800ms window also covers the refreshSession round-trip
          // on the happy path (it completes before setTimeout fires).
          setTimeout(() => router.replace("/kanban"), 800);
          return;
        }

        if (result.error.code === "FORBIDDEN") {
          setPageState("deactivated");
        } else {
          setPageState("activate-error");
          setActivateErrorMessage(
            result.error.message ||
              "Something went wrong activating your account. Please try again."
          );
        }
      },
      onError: () => {
        setPageState("activate-error");
        setActivateErrorMessage(
          "Something went wrong activating your account. Please try again."
        );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Form submit — validate → updateUser → activate
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameError(null);
    setPasswordError(null);
    setMismatch(false);

    const form = e.currentTarget;
    const name = (form.elements.namedItem("displayName") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const confirm = (form.elements.namedItem("confirmPassword") as HTMLInputElement).value;

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setNameError("Please enter your name (at least 2 characters).");
      nameRef.current?.focus();
      return;
    }

    const validation = validatePassword(password, confirm);

    if (validation.passwordError) {
      setPasswordError(validation.passwordError);
      passwordRef.current?.focus();
      return;
    }

    if (validation.mismatch) {
      setMismatch(true);
      confirmRef.current?.focus();
      return;
    }

    setPageState("submitting");

    const supabase = getSupabaseBrowserClient();

    // Fetch the caller's id (needed for the profiles UPDATE .eq() clause).
    // getUser() validates the JWT server-side rather than trusting local storage.
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      // Session lost between mount and submit — send back to invalid-link state.
      setPageState("no-session");
      return;
    }

    // 1. UPDATE display_name first — idempotent, no auth-side effect if it fails.
    //    Authorized by profiles_update_own RLS + GRANT UPDATE(display_name).
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", userData.user.id);

    if (profileError) {
      setNameError("Could not save your name. Please try again.");
      setPageState("form");
      requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }

    // 2. Set the password.
    const { error: passwordUpdateError } = await supabase.auth.updateUser({ password });

    if (passwordUpdateError) {
      // Supabase returns the server-side policy rejection here (e.g. too weak).
      setPasswordError(passwordUpdateError.message);
      setPageState("form");
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }

    // 3. Activate the profile (pending → active).
    runActivate();
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isInFlight = pageState === "submitting" || pageState === "activating";
  // Narrow to the only phase where the form button actually exists AND is in flight.
  // "activating" replaces the form entirely, so isInFlight would be misleading here.
  const submitDisabled = pageState === "submitting";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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

        {/* Checking session — blank while we confirm session existence */}
        {pageState === "checking" && null}

        {/* No session — link is invalid or expired */}
        {pageState === "no-session" && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-center dark:border-amber-700 dark:bg-amber-900/20"
          >
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Invite link invalid or expired
            </p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              This invite link is invalid or has expired. Ask your admin to resend
              the invitation.
            </p>
            <p className="mt-3 text-sm">
              <Link
                href="/login"
                className="font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        )}

        {/* Set-up form */}
        {(pageState === "form" || pageState === "submitting") && (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Set up your account
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Tell us your name and choose a password to finish signing up.
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate aria-busy={pageState === "submitting"} className="space-y-4">
              <div>
                <label
                  htmlFor="displayName"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Full name
                </label>
                <input
                  ref={nameRef}
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  required
                  disabled={isInFlight}
                  placeholder="Your name"
                  aria-describedby={nameError ? "name-error" : undefined}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
                />
                {nameError && (
                  <p
                    id="name-error"
                    role="alert"
                    className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                  >
                    {nameError}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={isInFlight}
                  placeholder="At least 8 characters"
                  aria-describedby={passwordError ? "password-error" : "password-hint"}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
                />
                {passwordError ? (
                  <p
                    id="password-error"
                    role="alert"
                    className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                  >
                    {passwordError}
                  </p>
                ) : (
                  <p
                    id="password-hint"
                    className="mt-1.5 text-xs text-slate-400 dark:text-slate-500"
                  >
                    Minimum 8 characters.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm password
                </label>
                <input
                  ref={confirmRef}
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={isInFlight}
                  placeholder="Repeat your password"
                  aria-describedby={mismatch ? "confirm-error" : undefined}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
                />
                {/* Conditionally mount so screen readers don’t announce an empty live region on mount */}
                {mismatch && (
                  <p
                    id="confirm-error"
                    role="alert"
                    className="mt-1.5 text-xs text-red-600 dark:text-red-400"
                  >
                    Passwords don&apos;t match.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitDisabled}
                aria-disabled={submitDisabled}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-slate-900"
              >
                {pageState === "submitting" ? (
                  <>
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      aria-hidden
                    />
                    Setting up your account...
                  </>
                ) : (
                  "Create account and continue"
                )}
              </button>
            </form>
          </>
        )}

        {/* Activating — password set; flipping profile status */}
        {pageState === "activating" && (
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Setting up your account...
            </p>
          </div>
        )}

        {/* Activate failed — password already set, retry activate only */}
        {pageState === "activate-error" && (
          <div className="flex flex-col items-center gap-4">
            <div
              role="alert"
              className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              <p className="font-medium">Account setup incomplete</p>
              <p className="mt-1">{activateErrorMessage}</p>
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                Your password has been saved. Tap retry to finish setup.
              </p>
            </div>
            <button
              type="button"
              onClick={runActivate}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
            >
              Retry
            </button>
          </div>
        )}

        {/* Deactivated — account was deactivated between invite and acceptance */}
        {pageState === "deactivated" && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-center dark:border-red-800 dark:bg-red-900/20"
          >
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              Account deactivated
            </p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              Your account has been deactivated. Contact your administrator.
            </p>
            <p className="mt-3 text-sm">
              <Link
                href="/login"
                className="font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        )}

        {/* Refresh error — activate succeeded but JWT refresh failed; user must re-login */}
        {pageState === "refresh-error" && (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-center dark:border-amber-700 dark:bg-amber-900/20"
          >
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Almost done
            </p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              Your account is active, but we could not refresh your session.
              Sign in to continue.
            </p>
            <p className="mt-3 text-sm">
              <Link
                href="/login"
                className="font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Sign in
              </Link>
            </p>
          </div>
        )}

        {/* Success */}
        {pageState === "success" && (
          <div
            role="status"
            className="flex flex-col items-center gap-3 text-center"
          >
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
      </div>
    </div>
  );
}
