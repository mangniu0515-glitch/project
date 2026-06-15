# Repository Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove low-value historical clutter from the repository without changing runtime behavior.

**Architecture:** This cleanup only touches documentation, root package metadata, and archived deployment notes. Runtime source files under `server/src`, `admin-panel/src`, and `chrome-extension/*.js` are left unchanged except for verification.

**Tech Stack:** Git, Markdown, npm, Node.js, Vue/Vite, Chrome Extension MV3.

---

### Task 1: Remove Obsolete Test/Selection Materials

**Files:**
- Delete: `SELECTION-MODE-GUIDE.md`
- Delete: `SELECTION-MODE-TROUBLESHOOTING.md`
- Delete: `TEST-PAGE-INSTRUCTIONS.md`
- Delete: `test-qrcode.html`

- [ ] Delete old garbled selection-mode and localhost 8080 test page files.
- [ ] Search the remaining repository for references to those filenames and old 8080 instructions.

### Task 2: Archive Server Deployment Notes

**Files:**
- Move: `WANGC_BACKEND_DEPLOYMENT.md` to `docs/archive/WANGC_BACKEND_DEPLOYMENT.md`
- Move: `WangC_start.sh` to `docs/archive/WangC_start.sh`

- [ ] Create `docs/archive`.
- [ ] Move old WangC deployment notes and startup script out of the repository root.
- [ ] Keep the files available for rollback context, but no longer prominent on GitHub root.

### Task 3: Remove Unused Root Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Remove root-level `ssh2`, which is not referenced by current source.
- [ ] Run `npm install --package-lock-only` from the repository root to update `package-lock.json`.
- [ ] Verify `npm ls --depth=0` no longer lists root dependencies unless newly required.

### Task 4: Verify and Publish

**Files:**
- No new source files expected.

- [ ] Run JSON parsing for `package.json` and `chrome-extension/manifest.json`.
- [ ] Run backend syntax checks.
- [ ] Run extension syntax checks.
- [ ] Run `npm run build` in `admin-panel`.
- [ ] Commit as `chore: slim repository clutter`.
- [ ] Push to `origin/main`.
