"use client";

/**
 * useResendInvite — TanStack Query mutation hook for resending a pending
 * invitation email (refreshing the invite token).
 *
 * Calls resendInviteAction which:
 *   1. Validates target status === 'pending'.
 *   2. Calls auth.admin.inviteUserByEmail to refresh the invite token.
 *   3. Writes an 'invite_resent' audit log entry.
 *
 * Cache invalidation: NONE.
 *   The profiles row is unchanged by a resend — only the auth invite token
 *   refreshes. No data visible in the admin list changes. Per the backend
 *   handoff: "No cache invalidation needed — the profile row is unchanged."
 *
 *   If a NOT_FOUND or not_pending error is returned (race case where the
 *   invite was accepted between the admin loading the page and clicking
 *   "Resend"), the caller should invalidate lists() manually to refresh
 *   the stale row. This is handled in the caller (EmployeesPageContent).
 *
 * Error contract: The mutation never throws. Check the ActionResult shape
 * returned by mutationFn to discriminate success from failure.
 *
 * Only valid on employees with status === 'pending'. The backend enforces this;
 * the UI MUST also gate the action to pending rows only.
 */

import { useMutation } from "@tanstack/react-query";
import { resendInviteAction } from "../services/employeesLifecycleActions";
import type { ActionResult, ResendInviteResult } from "../types";

interface ResendInviteInput {
  targetProfileId: string;
  email: string;
}

export function useResendInvite() {
  return useMutation<ActionResult<ResendInviteResult>, Error, ResendInviteInput>({
    mutationFn: ({ targetProfileId, email }: ResendInviteInput) =>
      resendInviteAction(targetProfileId, email),
    // No onSuccess invalidation — profile row is unchanged (see JSDoc above).
  });
}
