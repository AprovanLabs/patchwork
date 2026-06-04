import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { EDIT_PROMPT } from "@aprovan/stitchery";
import { streamText } from "ai";

export class EditService {
  constructor(private readonly baseUrl: string) {}

  async *streamEdit(code: string, prompt: string): AsyncGenerator<string> {
    const provider = createOpenAICompatible({
      name: "copilot-proxy",
      baseURL: this.baseUrl,
    });

    const result = streamText({
      model: provider("claude-opus-4.5"),
      system: `Current component code:\n\`\`\`tsx\n${code}\n\`\`\`\n\n${EDIT_PROMPT}`,
      messages: [{ role: "user", content: prompt }],
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }
}
