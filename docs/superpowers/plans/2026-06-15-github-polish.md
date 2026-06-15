# GitHub Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the uploaded repository into a clear, credible GitHub project without changing product behavior.

**Architecture:** This is a documentation and repository-presentation pass. It rewrites corrupted public-facing text, adds onboarding/security/deployment documents, and adds lightweight GitHub templates plus CI checks.

**Tech Stack:** Markdown, GitHub Actions, Node.js, Vue 3, Express, Chrome Extension MV3.

---

### Task 1: Rewrite Project Landing Page

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `chrome-extension/manifest.json`

- [ ] Replace the garbled README with a concise Chinese project overview, feature list, architecture, quick start, deployment notes, and safety notes.
- [ ] Fix the root package description so GitHub and npm tooling display readable metadata.
- [ ] Fix the extension name and description in the manifest without changing permissions or scripts.
- [ ] Validate JSON files with `node -e "JSON.parse(...)"`.

### Task 2: Add GitHub-Friendly Supporting Docs

**Files:**
- Create: `docs/GETTING_STARTED.md`
- Create: `docs/DEPLOYMENT.md`
- Create: `docs/SECURITY.md`
- Create: `docs/GITHUB_ACCOUNT_CHECKLIST.md`
- Create: `CONTRIBUTING.md`
- Create: `LICENSE`

- [ ] Add a manager/developer onboarding guide covering backend, admin panel, and extension.
- [ ] Add deployment notes for the current 3010/3011 server pattern without including secrets.
- [ ] Add a security note that explains ignored secrets, local data, extension packaging, and account hardening.
- [ ] Add a GitHub account checklist for profile name, avatar, bio, pinned repository, and optional profile README.
- [ ] Add a simple contribution guide and MIT license text.

### Task 3: Add Repository Hygiene

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/pull_request_template.md`

- [ ] Add CI to run backend syntax checks, extension syntax checks, and admin build.
- [ ] Add minimal issue and PR templates that match this internal tooling project.
- [ ] Run local validation commands before committing.
- [ ] Commit and push the documentation polish to `origin/main`.
