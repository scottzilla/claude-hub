---
description: Find and resume a previous Claude Code session across all projects
argument-hint: "[search term]"
---

Run `${CLAUDE_PLUGIN_ROOT}/scripts/list-sessions.sh "$ARGUMENTS"` via the Bash tool. It scans every Claude Code session on this machine (all projects, not just the current directory) and prints one line per session, most recent first, tab-separated as:

```
id	title	cwd	branch	relative-time
```

If `$ARGUMENTS` is empty, the script lists all sessions; otherwise it's already filtered to sessions whose title or user messages match the search term case-insensitively — do not re-filter the results yourself.

Format the output as a numbered, human-readable list, one session per line, using this shape:

```
1. <title> · <basename of cwd> · <branch> · <relative-time>
2. <title> · <basename of cwd> · <branch> · <relative-time>
...
```

If the script prints nothing, tell the user no matching sessions were found and stop.

Then ask the user which number they want to resume.

Once they pick one, print the exact copy-pasteable command for that session (do not run it yourself):

```
cd "<cwd>" && claude --resume <id>
```

using the session's full `cwd` and `id` from the tab-separated output (not the truncated basename shown in the list).

**Important — explain why you can't just resume it for them:** this command is running inside a Claude Code turn via the Bash tool, which has no TTY and cannot take over the user's parent shell process. `claude --resume` needs to become the user's terminal session, and only a process the user runs directly (with a real TTY) can `exec` into it. This is by design, not a bug or missing feature — tell the user this plainly (briefly) if they ask why you didn't just resume it, rather than leaving it looking like something went wrong. Mention that `plugins/session-finder/bin/session-finder` (run directly in their terminal, not through Claude Code) can auto-resume via `exec`, if they want that.
