# session-finder

Find and resume a previous Claude Code session — searching across **all projects**, not just the current directory. That's the actual gap this fills versus native `-c/--continue` and `-r/--resume`, which are scoped to the cwd they're run from (`claude --resume <id>` from a different directory than the session's original cwd fails with "No conversation found").

Sessions live at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. This plugin scans all of them, extracts each session's title, real working directory, git branch, and recency, and lets you pick one to resume — via two entry points that share the same underlying logic (`scripts/list-sessions.sh`).

## `/session-finder` (slash command)

Run inside Claude Code:

```
/session-finder [search term]
```

Lists matching sessions as a numbered list and, once you pick one, prints the exact copy-pasteable command:

```
cd "<cwd>" && claude --resume <id>
```

**It does not run this command for you.** A slash command executes via the Bash tool, which has no TTY and can't replace your terminal's parent shell process — so it can never actually "become" the resumed session. This is a deliberate limitation of Claude Code's tool architecture, not a bug: only a process you run directly, with a real TTY, can hand control over to `claude --resume`. That's what the script below does.

## `bin/session-finder` (standalone script)

Run **directly in your terminal**, not through Claude Code:

```bash
plugins/session-finder/bin/session-finder [search term]
```

This one *does* auto-resume: it uses `exec claude --resume <id>` to replace its own process with the resumed session, so you land directly inside it. If [`fzf`](https://github.com/junegunn/fzf) is installed, selection is an interactive fuzzy-search picker; otherwise it falls back to a numbered list with a plain prompt.

### Install

Since this repo is cloned locally, either add the `bin/` directory to your `PATH`, or add an alias/function to your shell rc file (adjust the path to where you cloned `claude-hub`):

```bash
alias resume-session="/path/to/claude-hub/plugins/session-finder/bin/session-finder"
```

## Requirements

- [`jq`](https://jqlang.org/) — used to parse session JSONL files. Both entry points fail with a clear error if it's missing.
- [`fzf`](https://github.com/junegunn/fzf) — optional, only used by `bin/session-finder` for interactive fuzzy-select.

## How titles and metadata are determined

- **Title**: the last `{"type":"ai-title", "aiTitle": ...}` line in the session file, if present. Otherwise, the first user message whose content is a plain string and isn't a synthetic/system-injected line (slash-command echoes, caveats, etc.).
- **Working directory**: read from the `cwd` field embedded in the session's JSONL lines — not decoded from the project directory name, which is ambiguous when path segments contain literal hyphens.
- **Branch / recency**: read from `gitBranch` and `timestamp` fields in the JSONL lines; file mtime is used as a recency fallback if timestamps can't be parsed.
- **Search**: matches the title or any user-message content, case-insensitively.
