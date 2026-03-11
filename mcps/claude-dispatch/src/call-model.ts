import Anthropic from "@anthropic-ai/sdk";
import type { WorkerConfig } from "./workers.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export async function callModel(
  worker: WorkerConfig,
  task: string,
  context?: string,
): Promise<string> {
  const anthropic = getClient();

  let userContent = task;
  if (context) {
    userContent += "\n\n---\n\nContext:\n" + context;
  }

  try {
    const response = await anthropic.messages.create({
      model: worker.model,
      max_tokens: worker.maxTokens,
      system: worker.systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const textBlocks = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text);

    if (textBlocks.length === 0) {
      return "[Worker returned no text content]";
    }

    return textBlocks.join("\n\n");
  } catch (error: unknown) {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        throw new Error(`Rate limited by Anthropic API. Please wait and retry. (${error.message})`);
      }
      if (error.status === 401) {
        throw new Error(`Invalid ANTHROPIC_API_KEY. Check your environment variable. (${error.message})`);
      }
      if (error.status === 529) {
        throw new Error(`Anthropic API is overloaded. Please retry later. (${error.message})`);
      }
      throw new Error(`Anthropic API error (${error.status}): ${error.message}`);
    }

    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to call model ${worker.model}: ${msg}`);
  }
}
