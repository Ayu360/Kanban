"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12 },
  },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 py-4 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80"
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500 text-white">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Kanban</span>
          </div>
          <Link
            href="/login"
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            Get Started
          </Link>
        </div>
      </motion.header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-16 text-center"
        >
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl">
            How it works
          </h1>
          <p className="mx-auto max-w-xl text-lg text-slate-600 dark:text-slate-400">
            A quick visual guide to using the Kanban board. No login needed—explore at your own pace.
          </p>
        </motion.section>

        {/* Steps */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-20"
        >
          {/* Step 1: Columns */}
          <motion.section variants={item} className="scroll-mt-20">
            <div className="mb-6 flex items-center gap-3">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
              >
                1
              </motion.span>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Columns organize your workflow
              </h2>
            </div>
            <p className="mb-6 text-slate-600 dark:text-slate-400">
              Your board starts with three columns: <strong>To Do</strong>, <strong>In Progress</strong>, and{" "}
              <strong>Done</strong>. Each column holds tasks at a different stage of completion.
            </p>
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col gap-4 sm:flex-row sm:justify-center"
            >
              {["To Do", "In Progress", "Done"].map((title, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.15 }}
                  className="min-w-[200px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-800/50"
                >
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    {title}
                  </h3>
                  <div className="space-y-2">
                    {i === 0 && (
                      <>
                        <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-600" />
                        <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-600" />
                      </>
                    )}
                    {i === 1 && (
                      <motion.div
                        animate={{ opacity: [1, 0.7, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="rounded-lg border bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-700"
                      >
                        <div className="h-4 w-full rounded bg-slate-300 dark:bg-slate-600" />
                        <div className="mt-2 h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-500" />
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.section>

          {/* Step 2: Drag and Drop */}
          <motion.section variants={item} className="scroll-mt-20">
            <div className="mb-6 flex items-center gap-3">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
              >
                2
              </motion.span>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Drag cards to move them
              </h2>
            </div>
            <p className="mb-6 text-slate-600 dark:text-slate-400">
              Grab any card and drag it into another column to update its status. On desktop, use your mouse. On mobile, tap a card and choose where to move it.
            </p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-600 dark:bg-slate-800"
            >
              <motion.div
                animate={{ x: [0, 120, 0] }}
                transition={{ duration: 3, repeat: Infinity, repeatDelay: 1 }}
                className="flex cursor-grab items-center gap-2 rounded-lg border bg-white p-3 shadow-md dark:border-slate-600 dark:bg-slate-700"
              >
                <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                </svg>
                <span className="font-medium text-slate-900 dark:text-slate-100">Drag me!</span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0.5 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="flex h-1 w-12 items-center"
              >
                <motion.div
                  animate={{ scaleX: [0.5, 1.2, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="h-1 w-full origin-left rounded-full bg-sky-500"
                />
              </motion.div>
              <div className="rounded-xl border-2 border-dashed border-sky-400 bg-sky-50/50 p-4 dark:border-sky-500 dark:bg-sky-900/20">
                <span className="text-sm font-medium text-sky-700 dark:text-sky-300">Drop zone</span>
              </div>
            </motion.div>
          </motion.section>

          {/* Step 3: Add & Edit */}
          <motion.section variants={item} className="scroll-mt-20">
            <div className="mb-6 flex items-center gap-3">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
              >
                3
              </motion.span>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Add and edit cards
              </h2>
            </div>
            <p className="mb-6 text-slate-600 dark:text-slate-400">
              Click <strong>&quot;Add card&quot;</strong> in any column to create a new task. Hover over a card and click{" "}
              <strong>Edit</strong> to change its title and description. Use the gear icon in a column header to rename it.
            </p>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-800">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">Column</span>
                </div>
                <div className="space-y-2">
                  <div className="rounded-lg border bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-700">
                    <div className="h-4 w-full rounded bg-slate-300 dark:bg-slate-500" />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-sky-300 py-2 text-sm font-medium text-sky-600 dark:border-sky-500 dark:text-sky-400"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add card
                  </motion.button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-800">
                <div className="mb-3 text-xs font-semibold uppercase text-slate-600 dark:text-slate-400">
                  Hover to reveal
                </div>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="group rounded-lg border bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-700"
                >
                  <div className="h-4 w-3/4 rounded bg-slate-300 dark:bg-slate-500" />
                  <motion.div
                    initial={{ opacity: 0 }}
                    whileHover={{ opacity: 1 }}
                    className="mt-3 flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </motion.div>
                </motion.div>
              </div>
            </motion.div>
          </motion.section>

          {/* Step 4: Search */}
          <motion.section variants={item} className="scroll-mt-20">
            <div className="mb-6 flex items-center gap-3">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
              >
                4
              </motion.span>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Search across all cards
              </h2>
            </div>
            <p className="mb-6 text-slate-600 dark:text-slate-400">
              Use the search bar in the header to filter cards by title or description. Results update as you type.
            </p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-800"
            >
              <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <motion.span
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-slate-500 dark:text-slate-400"
              >
                Search cards...
              </motion.span>
            </motion.div>
          </motion.section>

          {/* Step 5: Switch user */}
          <motion.section variants={item} className="scroll-mt-20">
            <div className="mb-6 flex items-center gap-3">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
              >
                5
              </motion.span>
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Switch users anytime
              </h2>
            </div>
            <p className="mb-6 text-slate-600 dark:text-slate-400">
              This is a demo—each user has their own board. Use the header dropdown to switch between users or log out.
            </p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-800"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
                A
              </div>
              <span className="font-medium text-slate-900 dark:text-slate-100">Alice</span>
              <svg className="ml-auto h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </motion.div>
          </motion.section>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-20 rounded-2xl border border-sky-200 bg-sky-50 p-8 text-center dark:border-sky-800 dark:bg-sky-900/20"
        >
          <h3 className="mb-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
            Ready to try it?
          </h3>
          <p className="mb-6 text-slate-600 dark:text-slate-400">
            Pick a user on the login page and start organizing your tasks.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-6 py-3 font-medium text-white transition hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            Go to Login
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
