"use client";

/**
 * TeamDetailContent — client-side content for /teams/[teamId].
 *
 * Renders:
 *   - Team name header with inline rename trigger (admin only)
 *   - Board link
 *   - Delete button with confirmation dialog (admin only)
 *   - TeamMembersList (members + add/remove, gated by role)
 *
 * Server state: useTeam for the team record.
 * Mutations: useRenameTeam, useDeleteTeam.
 *
 * After delete, redirects to /teams via router.push since the team no longer
 * exists. Delete confirmation shows the PRD-required warning text (FR-03).
 *
 * L-4: Delete error banner includes an accessible dismiss button.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { useTeam } from "../hooks/useTeam";
import { useRenameTeam } from "../hooks/useRenameTeam";
import { useDeleteTeam } from "../hooks/useDeleteTeam";
import TeamFormModal from "./TeamFormModal";
import ConfirmDialog from "./ConfirmDialog";
import TeamMembersList from "./TeamMembersList";

interface TeamDetailContentProps {
  teamId: string;
}

export default function TeamDetailContent({ teamId }: TeamDetailContentProps) {
  const router = useRouter();
  const { user } = useCurrentUser();
  const { team, isLoading, error } = useTeam(teamId);

  const renameMutation = useRenameTeam();
  const deleteMutation = useDeleteTeam();

  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isAdmin =
    !!user && (user.role === "admin" || user.isPlatformAdmin);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleRename = (name: string) => {
    setRenameError(null);
    renameMutation.mutate(
      { teamId, name },
      {
        onSuccess: (result) => {
          if (result.success) {
            setRenameModalOpen(false);
          } else {
            setRenameError(result.error.message);
          }
        },
        onError: () => {
          setRenameError("Failed to rename team. Please try again.");
        },
      }
    );
  };

  const handleDeleteConfirm = () => {
    setDeleteError(null);
    deleteMutation.mutate(teamId, {
      onSuccess: (result) => {
        if (result.success) {
          // Navigate away — the team no longer exists.
          router.push("/teams");
        } else {
          setDeleteError(result.error.message);
          setDeleteDialogOpen(false);
        }
      },
      onError: () => {
        setDeleteError("Failed to delete team. Please try again.");
        setDeleteDialogOpen(false);
      },
    });
  };

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Loading team...
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not found / no access
  // -------------------------------------------------------------------------

  if (error || !team) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
          <svg
            className="h-7 w-7 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Team not found
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This team may have been deleted or you may not have access.
        </p>
        <Link
          href="/teams"
          className="mt-2 text-sm font-medium text-sky-600 transition hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
        >
          Back to teams
        </Link>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          href="/teams"
          className="flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          All teams
        </Link>
      </nav>

      {/* L-4: Delete error banner with accessible dismiss action */}
      {deleteError && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          <span>{deleteError}</span>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            aria-label="Dismiss error"
            className="shrink-0 rounded p-0.5 text-red-500 transition hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 dark:text-red-400 dark:hover:bg-red-900/40 dark:hover:text-red-300"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Team header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {team.name}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Created {new Date(team.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Board link */}
          <Link
            href={`/teams/${teamId}/board`}
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-300 dark:hover:bg-sky-900/40"
            aria-label={`Go to board for ${team.name}`}
          >
            <span className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4"
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
              Board
            </span>
          </Link>

          {/* Admin-only: rename + delete */}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  setRenameError(null);
                  setRenameModalOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Rename
              </button>

              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteDialogOpen(true);
                }}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {deleteMutation.isPending ? (
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-red-600"
                    aria-hidden
                  />
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                )}
                Delete team
              </button>
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <hr className="mb-8 border-slate-200 dark:border-slate-700" />

      {/* Members section */}
      <TeamMembersList teamId={teamId} isAdmin={isAdmin} />

      {/* Rename modal */}
      {renameModalOpen && (
        <TeamFormModal
          mode="rename"
          initialName={team.name}
          isPending={renameMutation.isPending}
          errorMessage={renameError}
          onSubmit={handleRename}
          onClose={() => {
            if (!renameMutation.isPending) {
              setRenameModalOpen(false);
              setRenameError(null);
            }
          }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Delete team"
        description={`Deleting "${team.name}" will permanently delete its board and all tasks. This cannot be undone.`}
        confirmLabel="Delete team"
        isPending={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            setDeleteDialogOpen(false);
          }
        }}
      />
    </div>
  );
}
