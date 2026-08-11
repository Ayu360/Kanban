"use client";

/**
 * TeamsPageContent — the client-side content for the /teams route.
 *
 * Orchestrates:
 *   - useTeams (read)
 *   - useCreateTeam, useRenameTeam, useDeleteTeam (mutations)
 *   - Role-based UI: admin sees create + rename + delete; employee is read-only
 *   - Loading / error / empty states
 *
 * State managed here (UI state, not server state):
 *   - createModalOpen: boolean
 *   - renameTarget: { teamId, name } | null
 *   - deleteTarget: { teamId, name } | null
 *   - perTeam error messages (create / rename / delete)
 *
 * Server state lives entirely in TanStack Query (useTeams, mutation hooks).
 * No Teams data is duplicated into Redux.
 */

import { useState } from "react";
import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { useTeams } from "../hooks/useTeams";
import { useCreateTeam } from "../hooks/useCreateTeam";
import { useRenameTeam } from "../hooks/useRenameTeam";
import { useDeleteTeam } from "../hooks/useDeleteTeam";
import TeamCard from "./TeamCard";
import TeamFormModal from "./TeamFormModal";
import ConfirmDialog from "./ConfirmDialog";
import TeamsEmptyState from "./TeamsEmptyState";

interface RenameTarget {
  teamId: string;
  name: string;
}

interface DeleteTarget {
  teamId: string;
  name: string;
}

export default function TeamsPageContent() {
  const { user } = useCurrentUser();
  const { teams, isLoading, error } = useTeams();

  const createMutation = useCreateTeam();
  const renameMutation = useRenameTeam();
  const deleteMutation = useDeleteTeam();

  // UI state — modal open/close and which team is being acted upon.
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Per-action error messages to display inside modals.
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Track which teamId is being deleted for per-card spinner.
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);

  const isAdmin =
    !!user && (user.role === "admin" || user.isPlatformAdmin);

  // useTransition is not needed here — useMutation handles pending state.
  // We use the mutation isPending flags directly.

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleCreate = (name: string) => {
    if (!user) return;
    setCreateError(null);

    createMutation.mutate(
      { companyId: user.companyId, name },
      {
        onSuccess: (result) => {
          if (result.success) {
            setCreateModalOpen(false);
          } else {
            setCreateError(result.error.message);
          }
        },
        onError: () => {
          setCreateError("Failed to create team. Please try again.");
        },
      }
    );
  };

  const handleRename = (name: string) => {
    if (!renameTarget) return;
    setRenameError(null);

    renameMutation.mutate(
      { teamId: renameTarget.teamId, name },
      {
        onSuccess: (result) => {
          if (result.success) {
            setRenameTarget(null);
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
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeletingTeamId(deleteTarget.teamId);

    deleteMutation.mutate(deleteTarget.teamId, {
      onSuccess: (result) => {
        if (result.success) {
          setDeleteTarget(null);
          setDeletingTeamId(null);
        } else {
          setDeleteError(result.error.message);
          setDeletingTeamId(null);
        }
      },
      onError: () => {
        setDeleteError("Failed to delete team. Please try again.");
        setDeletingTeamId(null);
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
          Loading teams...
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          Failed to load teams. Please refresh the page.
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Teams
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isAdmin
              ? "Manage your company's teams."
              : "Teams you belong to."}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreateModalOpen(true);
            }}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Create team
          </button>
        )}
      </div>

      {/* L-4: Delete error banner with accessible dismiss action */}
      {deleteError && !deleteTarget && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
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

      {/* Teams list */}
      {teams.length === 0 ? (
        <TeamsEmptyState
          isAdmin={isAdmin}
          onCreateTeam={
            isAdmin
              ? () => {
                  setCreateError(null);
                  setCreateModalOpen(true);
                }
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" role="list" aria-label="Teams list">
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard
                teamId={team.id}
                teamName={team.name}
                memberCount={team.memberCount}
                isAdmin={isAdmin}
                isDeletePending={deletingTeamId === team.id}
                onRename={() => {
                  setRenameError(null);
                  setRenameTarget({ teamId: team.id, name: team.name });
                }}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget({ teamId: team.id, name: team.name });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Create team modal */}
      {createModalOpen && (
        <TeamFormModal
          mode="create"
          isPending={createMutation.isPending}
          errorMessage={createError}
          onSubmit={handleCreate}
          onClose={() => {
            if (!createMutation.isPending) {
              setCreateModalOpen(false);
              setCreateError(null);
            }
          }}
        />
      )}

      {/* Rename team modal */}
      {renameTarget && (
        <TeamFormModal
          mode="rename"
          initialName={renameTarget.name}
          isPending={renameMutation.isPending}
          errorMessage={renameError}
          onSubmit={handleRename}
          onClose={() => {
            if (!renameMutation.isPending) {
              setRenameTarget(null);
              setRenameError(null);
            }
          }}
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete team"
        description={
          deleteTarget
            ? `Deleting "${deleteTarget.name}" will permanently delete its board and all tasks. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete team"
        isPending={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
