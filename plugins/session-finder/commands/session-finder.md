---
description: Find and resume a previous Claude Code session across all projects
argument-hint: "[search term]"
---

Run `${CLAUDE_PLUGIN_ROOT}/scripts/list-sessions.sh "$ARGUMENTS"` via the Bash tool. It scans every Claude Code session on this machine (all projects, not just the current directory) and prints one line per session, most recent first, tab-separated as:

```
id	title	cwd	branch	relative-time
```

If the search term is empty, the script lists all sessions; otherwise it's already filtered to sessions whose title or user messages match the search term case-insensitively — do not re-filter the results yourself.

**First, check whether you have the `AskUserQuestion` tool available in this session.**

## If you do NOT have `AskUserQuestion`

Fall back to the original plain-text flow, and skip the rest of this document:

1. Run the script with `$ARGUMENTS` as the search term. If it prints nothing, tell the user no matching sessions were found and stop.
2. Format the output as a numbered list, one session per line: `N. <title> · <basename of cwd> · <branch> · <relative-time>`.
3. Ask the user to reply with the number of the session they want to resume.
4. Once they reply with a number, print the exact copy-pasteable command for that session (do not run it yourself), using the full `cwd` and `id` from the tab-separated output (not the truncated basename shown in the list):

   ```
   cd "<cwd>" && claude --resume <id>
   ```
5. Explain (briefly, only if asked) why you can't run it yourself — see "Why this can't auto-resume" below.

## If you DO have `AskUserQuestion`

Use this picker-based flow. Keep track of which **round** you're on — round 1 is the initial search using `$ARGUMENTS`; each time the user picks "Other" and types a new search term, that starts the next round. **You get at most 3 rounds total** (i.e. at most 2 re-narrowings via "Other"). If the user is still picking "Other" at the end of round 3, stop looping (see "Round cap" below).

For each round:

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/list-sessions.sh "<current search term>"` via Bash (round 1 uses `$ARGUMENTS`; later rounds use whatever text the user typed into "Other").
2. **If it prints nothing**, tell the user no matching sessions were found for that search term and stop — this applies on every round, not just the first.
3. **If it prints 4 or fewer rows**, present all of them.
4. **If it prints more than 4 rows**, take only the first 4 rows (the script already sorts most-recent-first, so this is just the newest 4 matches) and present those.
5. Call `AskUserQuestion` with a single question:
   - `header`: `"Session"`
   - `multiSelect`: `false`
   - `question`: if you presented all matches (step 3), phrase it as something like `Which session do you want to resume?`. If you truncated to 4 (step 4), say how many matched and that you're showing the newest 4, e.g. `"<N> sessions matched \"<term>\" — showing the 4 most recent. Pick one, or choose Other to narrow your search."`
   - `options`: one entry per row you presented, in the same order:
     - `label`: the session's title, truncated to roughly 40 characters (append `…` if truncated) so it fits the picker UI. **Labels must be unique within the question** — if two rows would truncate to the same label (e.g. two sessions with the same title), disambiguate by appending the relative-time (or another short distinguishing suffix) to each, so every label maps to exactly one row.
     - `description`: `"<basename of cwd> · <branch> · <relative-time>"`
   - Do not add an "Other" option yourself — `AskUserQuestion` automatically offers a free-text "Other" choice on top of the options you give it.
6. Look at what the tool returns:
   - **If the user selected one of the options you offered**, that's their chosen session — match its (now-unique) label back to its full row to get its `id` and `cwd`, then skip to "Resuming" below.
   - **If the user answered via "Other"** (free text, not one of your listed options), treat that text as a **new search term**, not as a resume target or a number. If you are on round 3 already, do not run another search — go to "Round cap" below instead. Otherwise, start the next round using that text as the new search term (go back to step 1 above).

### Round cap

If the user picks "Other" again on round 3 (i.e. you'd otherwise need a 4th round), stop using `AskUserQuestion`. Instead, fall back to plain text for the round-3 results: print them as a numbered list (`N. <title> · <basename of cwd> · <branch> · <relative-time>`) and ask the user to reply directly with a number. Once they do, proceed to "Resuming" below using that row.

### Resuming

Once an actual session has been picked (not "Other"), print the exact copy-pasteable command for it (do not run it yourself), using the full `cwd` and `id` from the tab-separated output (not the truncated title/label shown in the picker):

```
cd "<cwd>" && claude --resume <id>
```

## Why this can't auto-resume

This command is running inside a Claude Code turn via the Bash tool, which has no TTY and cannot take over the user's parent shell process. `claude --resume` needs to become the user's terminal session, and only a process the user runs directly (with a real TTY) can `exec` into it. This is by design, not a bug or missing feature — tell the user this plainly (briefly) if they ask why you didn't just resume it, rather than leaving it looking like something went wrong. Mention that `plugins/session-finder/bin/session-finder` (run directly in their terminal, not through Claude Code) can auto-resume via `exec`, if they want that.
