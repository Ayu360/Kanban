"use client";

/**
 * TeamMembersList — renders the list of team members and the Add Member control.
 *
 * Admin view: member list + add member button + remove per-member.
 * Employee view: member list only (read-only).
 *
 * Uses useTeamMembers for server state. Member removal uses useRemoveTeamMember.
 * Member addition is handled via AddMemberModal + useAddTeamMember in parent.
 *
 * Authorization controls are UX-only. Backend/RLS is authoritative.
 *
 * M-3: Concurrent removal is tracked per-member via a Set<string> so removing
 * member A does not show a spinner on member B.
 *
 * M-5: Local search state filters the displayed list. The cached server data is
 * never mutated — search is a pure client-side derived view.
 */

import { useState } from "react";
import { useTeamMembers } from "../hooks/useTeamMembers";
import { useRemoveTeamMember } from "../hooks/useRemoveTeamMember";
import { useAddTeamMember } from "../hooks/useAddTeamMember";
import TeamMemberRow from "./TeamMemberRow";
import AddMemberModal from "./AddMemberModal";

interface TeamMembersListProps {
  teamId: string;
  isAdmin: boolean;
}

export default function TeamMembersList({
  teamId,
  isAdmin,
}: TeamMembersListProps) {
  const { members, isLoading, error } = useTeamMembers(teamId);
  const removeMutation = useRemoveTeamMember();
  const addMutation = useAddTeamMember();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // M-3: Track each in-flight removal independently so concurrent removals
  // don't steal each other's pending indicator.
  const [removingProfileIds, setRemovingProfileIds] = useState<Set<string>>(
    new Set()
  );
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  // M-5: Local search state — never stored in server cache.
  const [searchQuery, setSearchQuery] = useState("");

  const handleAddMember = (profileId: string) => {
    setAddError(null);
    addMutation.mutate(
      { teamId, profileId },
      {
        onSuccess: (result) => {
          if (result.success) {
            setAddModalOpen(false);
          } else {
            setAddError(result.error.message);
          }
        },
        onError: () => {
          setAddError("Failed to add member. Please try again.");
        },
      }
    );
  };

  const handleRemoveMember = (profileId: string) => {
    // Prevent duplicate in-flight removal for the same member.
    if (removingProfileIds.has(profileId)) return;

    setRemovingProfileIds((prev) => new Set(prev).add(profileId));
    setRemoveErrors((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });

    removeMutation.mutate(
      { teamId, profileId },
      {
        onSuccess: (result) => {
          // Always clear this member's pending state on success.
          setRemovingProfileIds((prev) => {
            const next = new Set(prev);
            next.delete(profileId);
            return next;
          });
          if (!result.success) {
            setRemoveErrors((prev) => ({
              ...prev,
              [profileId]: result.error.message,
            }));
          }
        },
        onError: () => {
          // Clear only this member's pending state on error.
          setRemovingProfileIds((prev) => {
            const next = new Set(prev);
            next.delete(profileId);
            return next;
          });
          setRemoveErrors((prev) => ({
            ...prev,
            [profileId]: "Failed to remove member. Please try again.",
          }));
        },
      }
    );
  };

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
        Loading members...
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
      >
        Failed to load members. Please refresh the page.
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // M-5: Derive filtered list from local search state.
  // Does NOT mutate the cached server data.
  // -------------------------------------------------------------------------

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredMembers =
    normalizedQuery.length === 0
      ? members
      : members.filter((m) => {
          const name = (m.displayName ?? "").toLowerCase();
          return name.includes(normalizedQuery);
        });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section aria-labelledby="members-heading">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2
          id="members-heading"
          className="text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          Members
          {members.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
              ({members.length})
            </span>
          )}
        </h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setAddError(null);
              setAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <svg
              className="h-3.5 w-3.5"
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
            Add member
          </button>
        )}
      </div>

      {/* M-5: Search input — only shown when there are members to search */}
      {members.length > 0 && (
        <div className="mb-4 relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          <label htmlFor="member-search" className="sr-only">
            Search members
          </label>
          <input
            id="member-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search members..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
          />
        </div>
      )}

      {/* Remove errors */}
      {Object.entries(removeErrors).map(([pid, msg]) => (
        <div
          key={pid}
          role="alert"
          className="mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          {msg}
        </div>
      ))}

      {/* Empty: no members at all */}
      {members.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
          No members yet.
          {isAdmin && " Use Add member to add employees to this team."}
        </div>
      ) : filteredMembers.length === 0 ? (
        /* Empty: members exist but search returned nothing */
        <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
          No members match &ldquo;{searchQuery.trim()}&rdquo;.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {filteredMembers.map((member) => (
            <TeamMemberRow
              key={member.profileId}
              profileId={member.profileId}
              displayName={member.displayName}
              role={member.role}
              isAdmin={isAdmin}
              isRemovePending={removingProfileIds.has(member.profileId)}
              onRemove={handleRemoveMember}
            />
          ))}
        </div>
      )}

      {/* Add member modal */}
      {addModalOpen && (
        <AddMemberModal
          teamId={teamId}
          isPending={addMutation.isPending}
          errorMessage={addError}
          onSubmit={handleAddMember}
          onClose={() => {
            if (!addMutation.isPending) {
              setAddModalOpen(false);
              setAddError(null);
            }
          }}
        />
      )}
    </section>
  );
}
