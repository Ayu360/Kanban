"use client";

/**
 * AddMemberModal — Add an employee to a team via a searchable employee picker.
 *
 * Upgraded from the interim UUID-input state (Teams module) to a real employee
 * picker backed by useEmployeeDirectory(). The directory excludes deactivated
 * employees at the view layer. Pending employees (displayName = null) are
 * filtered client-side per the backend handoff contract.
 *
 * The backend validates:
 *   - That the profileId belongs to the same company as the team (CROSS_COMPANY)
 *   - That the team exists (NOT_FOUND)
 *
 * Accessibility:
 *   - role="dialog" aria-modal, escape key, error alerts
 *   - Search input has a visible label (sr-only)
 *   - Employee picker uses role="group" with plain buttons — Tab cycles naturally
 *   - useFocusTrap handles: initial focus, Tab/Shift+Tab trap, trigger restore
 */

import { useEffect, useMemo, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEmployeeDirectory } from "@/features/employees/hooks/useEmployeeDirectory";

interface AddMemberModalProps {
  existingMemberIds: Set<string>;
  isPending: boolean;
  errorMessage: string | null;
  onSubmit: (profileId: string) => void;
  onClose: () => void;
}

export default function AddMemberModal({
  existingMemberIds,
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: AddMemberModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // AddMemberModal is always mounted when visible, so isOpen is always true.
  const containerRef = useFocusTrap(true);

  const { employees, isLoading: directoryLoading } = useEmployeeDirectory();

  // Layered filters (each memo derived from the previous) so the empty-state
  // branch below can distinguish the three cases without re-running filters:
  //   1. withNames         — all active employees (excludes pending, whose displayName is null)
  //   2. eligibleEmployees — active AND not already team members
  //   3. filteredEmployees — eligible AND matches the search query
  const withNames = useMemo(
    () => employees.filter((e) => e.displayName !== null),
    [employees]
  );
  const eligibleEmployees = useMemo(
    () => withNames.filter((e) => !existingMemberIds.has(e.id)),
    [withNames, existingMemberIds]
  );
  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return eligibleEmployees;
    return eligibleEmployees.filter((e) =>
      (e.displayName ?? "").toLowerCase().includes(q)
    );
  }, [eligibleEmployees, searchQuery]);

  const selectedEmployee = employees.find((e) => e.id === selectedId) ?? null;

  // Lock scroll on mount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape closes (unless pending).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isPending, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!selectedId) {
      setLocalError("Please select an employee.");
      return;
    }

    onSubmit(selectedId);
  };

  const displayedError = errorMessage ?? localError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={isPending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-member-title"
    >
      <div
        ref={containerRef}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <h2
          id="add-member-title"
          className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Add member
        </h2>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
          Search for an employee to add to this team.
        </p>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {/* Search input */}
          <div>
            <label htmlFor="member-picker-search" className="sr-only">
              Search employees
            </label>
            <div className="relative">
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
              <input
                id="member-picker-search"
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  // Clear selection when query changes.
                  setSelectedId(null);
                  setLocalError(null);
                }}
                placeholder="Search by name..."
                disabled={isPending || directoryLoading}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-sky-400"
              />
            </div>
          </div>

          {/* Employee picker — plain button group (Tab cycles naturally via focus trap).
              No listbox/option roles: WAI-ARIA listbox requires arrow-key handling
              which is not implemented here. Buttons are sufficient. */}
          <div
            role="group"
            aria-label="Employee list"
            className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-600"
          >
            {directoryLoading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"
                  aria-hidden
                />
                Loading employees...
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                {searchQuery.trim()
                  ? `No employees match "${searchQuery.trim()}".`
                  : withNames.length > 0 && eligibleEmployees.length === 0
                  ? "All employees are already members of this team."
                  : "No employees available."}
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const isSelected = selectedId === emp.id;
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(emp.id);
                      setLocalError(null);
                    }}
                    disabled={isPending}
                    className={[
                      "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500",
                      isSelected
                        ? "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                    ].join(" ")}
                  >
                    <span className="font-medium">{emp.displayName}</span>
                    <span
                      className={[
                        "ml-2 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        emp.role === "admin"
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
                      ].join(" ")}
                    >
                      {emp.role === "admin" ? "Admin" : "Employee"}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Selected summary */}
          {selectedEmployee && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Selected:{" "}
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {selectedEmployee.displayName}
              </span>
            </p>
          )}

          {/* Error */}
          {displayedError && (
            <p
              role="alert"
              className="text-xs text-red-600 dark:text-red-400"
            >
              {displayedError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !selectedId}
              className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
            >
              {isPending && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
              )}
              {isPending ? "Adding..." : "Add member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
