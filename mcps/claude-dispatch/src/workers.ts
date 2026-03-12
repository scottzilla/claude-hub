export interface WorkerConfig {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  description: string;
}

export const workers: Record<string, WorkerConfig> = {
  quick_task: {
    model: "claude-haiku-latest",
    maxTokens: 8192,
    description:
      "Fast, lightweight worker for simple lookups, formatting, " +
      "summarization, web research, and basic Q&A. Runs on Haiku (cheapest). " +
      "Use this for anything that does not require code writing or complex reasoning.",
    systemPrompt: `You are a fast research and formatting assistant. Your strengths:
- Searching and summarizing content concisely
- Formatting and restructuring text
- Answering factual questions
- Extracting data from logs, JSON, CSV

Be concise. Give direct answers. Do not over-explain.`,
  },

  code_task: {
    model: "claude-sonnet-latest",
    maxTokens: 16384,
    description:
      "General-purpose coding worker for writing code, fixing bugs, " +
      "refactoring, writing tests, and code review. Runs on Sonnet (balanced cost/quality). " +
      "Use for any task that involves reading and writing code.",
    systemPrompt: `You are an expert software engineer. Your job:
- Write clean, well-tested code
- Fix bugs by understanding the issue and making targeted changes
- Refactor code while preserving behavior
- Write tests that cover edge cases
- Review code for correctness, style, and potential issues

Approach:
1. Understand the existing patterns and conventions from any context provided
2. Make the minimum necessary changes
3. Explain key decisions briefly

Focus on working code, not lengthy commentary.`,
  },

  deep_think: {
    model: "claude-opus-latest",
    maxTokens: 32768,
    description:
      "Advanced reasoning worker for architecture design, security audits, " +
      "complex analysis, and ambiguous problems. Runs on Opus (most capable, most expensive). " +
      "Use only when the task requires deep reasoning that simpler models cannot handle.",
    systemPrompt: `You are a senior principal engineer. You handle the hardest problems:
- System architecture and design
- Security vulnerability analysis
- Complex multi-file refactoring plans
- Performance analysis requiring deep understanding of runtime behavior
- Problems where the correct approach is ambiguous

Your approach:
1. Fully understand the problem before responding. Analyze all provided context.
2. Consider multiple approaches. Think about trade-offs.
3. For architecture: document your reasoning and decisions.
4. For security: be systematic. Check OWASP top 10, auth flows, input validation, secrets management.
5. For refactoring: describe the plan step by step with rationale.

Take your time. Thoroughness matters more than speed at this tier.`,
  },
};
