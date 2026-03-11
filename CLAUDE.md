# Claude Workers

You have access to three worker agents optimized for different task tiers. **Prefer delegating to workers over handling tasks directly** to reduce cost and match model capability to task complexity.

## Routing

| Task type | Agent | Model | When to use |
|-----------|-------|-------|-------------|
| Lookups, summaries, formatting, Q&A, log analysis | `quick-task` | Haiku | Default for anything read-only or informational |
| Write code, fix bugs, refactor, tests, code review | `code-worker` | Sonnet | Any task that modifies code |
| Architecture, security audits, complex analysis | `deep-thinker` | Opus | Only when the task requires deep reasoning |

## Rules

- **Start cheap.** Default to `quick-task` unless the task clearly requires code writing or deep reasoning.
- **Don't use `deep-thinker` for routine work.** Reserve Opus for architecture decisions, security reviews, and genuinely ambiguous problems.
- **Delegate, don't duplicate.** When you send a task to a worker, trust the result. Don't redo the same work yourself.
- **Be specific in prompts.** Give the worker all the context it needs: file paths, error messages, requirements.
