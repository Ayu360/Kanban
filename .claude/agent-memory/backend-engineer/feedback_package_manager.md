---
name: Use yarn, not pnpm
description: This project uses yarn as the package manager — do not use pnpm
type: feedback
---

Always use `yarn` for package manager commands in this project (e.g., `yarn tsc --noEmit`, `yarn dev`, `yarn add`). Do not use `pnpm`.

**Why:** The user corrected a pnpm usage during the employees fix pass. The project's lockfile is `yarn.lock`.

**How to apply:** Any time you need to run a script from package.json or install packages, use `yarn`. Check `package.json` scripts section to find the right command name.
