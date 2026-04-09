---
name: scottclip-refresh-skills
description: This skill should be used when the user asks to "refresh skills", "update skills", "scan for new skills", "suggest skills", or runs the /sc-refresh-skills command. Re-scans the codebase and suggests new, updated, or removed project skills for ScottClip workers.
version: 0.1.0
---

# ScottClip Refresh Skills

Re-scan the codebase and suggest additions, updates, and removals for project skills in `.scottclip/skills/`. Present findings for approval before making any changes.

**Arguments:**
- `--auto-apply` — Apply all suggestions without confirmation (use with caution)
- `--dry-run` — Print suggestions without prompting for approval

## Step 1: Load Project Config

1. Read `.scottclip/config.yaml`. If missing, stop: "ScottClip not initialized. Run `/scottclip-init` first."
2. Note the `project.name` and `project.tech_stack` fields if present — they provide hints for scanning.
3. Read `CLAUDE.md` if it exists in the repo root. Note any explicitly documented conventions, test commands, lint commands, or workflow rules.

## Step 2: Inventory Existing Skills

1. Read `.claude/agents/worker.md`. Extract the current `skills:` list from the frontmatter — these are the skills already registered for the worker agent.
2. List all files in `.scottclip/skills/` to get the current set of project skill files.
3. For each skill file found, read its frontmatter `name` and `description` to understand what it covers.
4. Build two lists:
   - **Registered skills** — names from `worker.md` frontmatter `skills:` list
   - **Skill files** — names from `.scottclip/skills/*/SKILL.md` frontmatter

Note any mismatches (registered but no file, file but not registered) — these are candidates for cleanup.

## Step 3: Scan Codebase for Patterns

Detect frameworks, tooling, and conventions that project skills should cover. Read only the files listed below — do not recurse into `node_modules`, `.git`, `dist`, `build`, or other generated directories.

### Dependency files

- `package.json` — note `scripts`, `dependencies`, `devDependencies`
  - Test runner: vitest, jest, mocha, ava, tap
  - Linter: eslint, biome
  - Formatter: prettier, biome
  - Build tool: vite, esbuild, tsc, webpack, rollup, turbo
  - Framework: next, nuxt, remix, astro, express, fastify, hono
- `requirements.txt` or `pyproject.toml` — note test and lint tools
  - Test runner: pytest, unittest
  - Linter/formatter: ruff, flake8, black, mypy
  - Framework: fastapi, django, flask
- `go.mod` — detect Go project; note module name
- `Cargo.toml` — detect Rust project; note workspace layout

### Directory structure signals

- `db/migrations/` or `migrations/` → database migration skill candidate
- `src/components/` or `components/` → UI component conventions skill candidate
- `src/api/` or `api/` or `routes/` → API route conventions skill candidate
- `.github/workflows/` → CI workflow conventions worth documenting
- `docker-compose.yml` or `Dockerfile` → container/service startup skill candidate
- `prisma/` or `drizzle/` → ORM-specific skill candidate
- `e2e/` or `tests/e2e/` or `cypress/` or `playwright/` → E2E test skill candidate

### Test runner detection

- If `package.json` has `"test"` script, note the exact command
- If `vitest.config.*` exists, note any custom test patterns
- If `jest.config.*` exists, note any custom test patterns
- If `pytest.ini`, `setup.cfg`, or `pyproject.toml` has `[tool.pytest.*]`, note configuration

### Lint and format detection

- If `.eslintrc*` or `eslint.config.*` exists, note any project-specific rules
- If `.prettierrc*` exists, note config
- If `biome.json` exists, note lint and format settings
- If `ruff.toml` or `pyproject.toml` has `[tool.ruff]`, note configuration

## Step 4: Read Worker Memory

1. Check if `.claude/agent-memory/worker/` exists.
2. If it does, read the most recent 3 dated notes (e.g., `YYYY-MM-DD.md`) and `MEMORY.md` if present.
3. Look for recurring patterns: commands the worker runs repeatedly, gotchas that came up multiple times, workflow steps that required multiple attempts.
4. These patterns are strong candidates for new or updated skills — they represent hard-won operational knowledge.

## Step 5: Compare and Build Suggestions

Compare codebase findings (Step 3) and memory patterns (Step 4) against the existing skills inventory (Step 2).

For each finding, determine one of:

**`+ New`** — No existing skill covers this pattern. A new skill would help workers avoid mistakes or reduce repeated lookups.

**`~ Update`** — An existing skill partially covers this, but the content is outdated or missing key details from the current codebase state.

**`- Remove`** — An existing skill covers a tool, framework, or pattern that is no longer present in the codebase.

**No action** — Pattern is already well-covered by an existing skill.

Guidelines for this comparison:

- Prefer `~ Update` over `+ New` whenever an existing skill overlaps even partially
- Only propose `+ New` when no existing skill could reasonably be extended to cover the pattern
- Propose `- Remove` only when the underlying tool or framework is fully absent from the codebase (not just unused in one area)
- Plugin-shipped skills (names starting with `scottclip:`) are never modified — skip them entirely

## Step 6: Present Suggestions

Display a structured summary. If there are no suggestions, report: "Skills are up to date — no changes needed."

Otherwise, format the output as:

```
Skill refresh suggestions for <project name>:

+ New: run-tests
  Why: package.json uses vitest with custom --workspace flag. Workers need the exact command to avoid running the wrong test suite.
  File: .scottclip/skills/run-tests/SKILL.md

~ Update: db-migrations
  Why: Project migrated from raw SQL to Drizzle ORM. Current skill references psql commands that no longer apply.
  File: .scottclip/skills/db-migrations/SKILL.md

- Remove: webpack-build
  Why: webpack.config.js no longer exists. Project uses Vite (detected in package.json).
  File: .scottclip/skills/webpack-build/SKILL.md

Orphaned registrations (in worker.md but no skill file):
  - old-skill-name

Unregistered files (skill file exists but not in worker.md):
  - another-skill-name
```

If `--dry-run` is set, stop here and exit.

## Step 7: Get Approval

Unless `--auto-apply` is set, ask: "Apply these changes? [Y/n/edit]"

- `Y` or enter → proceed with all suggestions
- `n` → exit without changes
- `edit` → ask which specific suggestions to apply, then proceed with that subset

## Step 8: Apply Changes

For each approved suggestion:

### New skill

1. Create directory `.scottclip/skills/<skill-name>/`.
2. Write `SKILL.md` with:
   - Frontmatter: `name`, `description` (third person, explains trigger), `version: 0.1.0`
   - Body: imperative instructions covering the detected pattern (under 500 words)
   - Include the exact commands detected from the codebase (test command, lint command, etc.)

### Update skill

1. Read the existing `.scottclip/skills/<skill-name>/SKILL.md`.
2. Make targeted edits: update outdated commands, add new patterns, remove obsolete content.
3. Bump the patch version in frontmatter (e.g., `0.1.0` → `0.1.1`).
4. Write the updated file.

### Remove skill

1. Delete `.scottclip/skills/<skill-name>/SKILL.md` and the directory if empty.

## Step 9: Sync worker.md

1. Read `.claude/agents/worker.md`.
2. Build the updated `skills:` list:
   - Remove names for deleted skills
   - Add names for new skills (format: `scottclip:<skill-name>` for plugin skills, `project:<skill-name>` for project skills in `.scottclip/skills/`)
   - Fix any orphaned or unregistered entries found in Step 2
3. Write the updated frontmatter back to `.claude/agents/worker.md`. Preserve all other frontmatter fields and the entire body unchanged.

## Step 10: Report Summary

Print a final summary:

```
Skills updated:
  + Created: run-tests (.scottclip/skills/run-tests/SKILL.md)
  ~ Updated: db-migrations (v0.1.0 → v0.1.1)
  - Removed: webpack-build
  ~ Fixed: 1 orphaned registration, 1 unregistered file

worker.md skills list synced. Workers will use updated skills on next heartbeat.
```

If no changes were applied, report: "No changes applied."
