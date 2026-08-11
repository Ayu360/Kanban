"use client";

/**
 * useFocusTrap — WAI-ARIA modal focus management.
 *
 * On open:
 *   - Saves the currently focused element as the restore target.
 *   - Moves focus into the modal container on the next frame.
 *
 * While open:
 *   - Tab cycles forward through focusable elements inside the container.
 *   - Shift+Tab cycles backward.
 *   - Focus cannot escape to background elements.
 *
 * On close (containerRef unmounts or isOpen becomes false):
 *   - Restores focus to the saved trigger element (if it still exists in the DOM).
 *
 * Usage:
 *   const containerRef = useFocusTrap(isOpen);
 *   <div ref={containerRef} ...>...</div>
 */

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
}

export function useFocusTrap(isOpen: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stores the element that had focus before the modal opened.
  const triggerRef = useRef<Element | null>(null);

  // Capture trigger, move focus into the container when the modal opens, and
  // restore focus when the modal closes. Restoration is handled in the cleanup
  // function rather than a separate effect so that it fires in both cases:
  //   1. isOpen transitions true → false (ConfirmDialog, which stays mounted).
  //   2. The component unmounts while isOpen is still true (TeamFormModal,
  //      AddMemberModal, which are conditionally rendered and never receive an
  //      isOpen=false prop — React only runs cleanup on unmount, not effect bodies).
  useEffect(() => {
    if (!isOpen) return;

    // Save the element that currently has focus so we can restore it on close.
    triggerRef.current = document.activeElement;

    // Move focus into the container on the next frame to allow the DOM to paint.
    const frameId = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        // If nothing is focusable, focus the container itself as a fallback.
        container.focus();
      }
    });

    return () => {
      // Cancel any pending frame so an in-flight focus-into-modal call does not
      // race with the restoration below.
      cancelAnimationFrame(frameId);

      // Restore focus to the element that was active when the modal opened.
      // Guard: only focus if the element is still an HTMLElement present in the
      // document (covers unmount of off-screen modals and detached nodes).
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
      // Clear the ref so stale references do not linger across re-opens.
      triggerRef.current = null;
    };
  }, [isOpen]);

  // Tab / Shift+Tab trap while modal is open.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if focus is on or before the first element, wrap to last.
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if focus is on or after the last element, wrap to first.
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return containerRef;
}
