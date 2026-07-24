import { applyDiffs, hasDiffBlocks, parseEditResponse } from "../../lib/diff";
import type { EditRequest, EditResponse } from "./types";

/**
 * A host-supplied edit backend: given the request, return the model's raw
 * reply (search/replace blocks + optional summary). Lets a serverless host
 * route edits through its own LLM (e.g. the gateway) instead of a `/api/edit`
 * route. `onProgress` may be called with streamed note text.
 */
export type EditTransport = (
  request: EditRequest,
  onProgress?: (note: string) => void,
) => Promise<string>;

export interface EditApiOptions {
  endpoint?: string;
  /** Preferred over `endpoint`: run the edit through a host LLM. */
  transport?: EditTransport;
  onProgress?: (note: string) => void;
  /** Automatically remove stray diff markers from output (default: true) */
  sanitize?: boolean;
}

export async function sendEditRequest(
  request: EditRequest,
  options: EditApiOptions = {},
): Promise<EditResponse> {
  const { endpoint = "/api/edit", transport, onProgress, sanitize = true } = options;

  const text = transport
    ? await transport(request, onProgress)
    : await fetchEditText(endpoint, request, onProgress);

  if (!hasDiffBlocks(text)) {
    // No diffs — return the original code unchanged with the response as summary
    return {
      newCode: request.code,
      summary: text.trim(),
      progressNotes: [],
    };
  }

  const parsed = parseEditResponse(text);
  const result = applyDiffs(request.code, parsed.diffs, { sanitize });

  if (result.applied === 0) {
    // Provide detailed context about failed diffs for better error feedback
    const failedDetails = result.failed
      .map((f, i) => `[${i + 1}] "${f}"`)
      .join("\n");
    throw new Error(
      `Failed to apply ${parsed.diffs.length} diff(s). None of the SEARCH blocks matched the code.\n\nFailed searches:\n${failedDetails}\n\nThis usually means the code has changed or the SEARCH text doesn't match exactly.`,
    );
  }

  // Include warning in summary if markers were detected
  let summary = parsed.summary || `Applied ${result.applied} change(s)`;
  if (result.warning) {
    summary = `⚠️ ${result.warning}\n\n${summary}`;
  }

  return {
    newCode: result.code,
    summary,
    progressNotes: parsed.progressNotes,
  };
}

/** Default transport: POST the request to `endpoint` and read the reply. */
async function fetchEditText(
  endpoint: string,
  request: EditRequest,
  onProgress?: (note: string) => void,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error("Edit request failed");
  }
  return streamResponse(response, onProgress);
}

async function streamResponse(
  response: Response,
  onProgress?: (note: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }

  const decoder = new TextDecoder();
  let fullText = "";
  const emittedNotes = new Set<string>();

  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) {
      fullText += decoder.decode(result.value, { stream: true });

      if (onProgress) {
        // Extract notes from code fence attributes as they stream in.
        // Format: ```lang note="description" path="@/file.tsx"
        // Match complete attribute to avoid emitting partial notes.
        const noteAttrRegex = /```\w*\s+note="([^"]+)"/g;
        let match;
        while ((match = noteAttrRegex.exec(fullText)) !== null) {
          const noteMatch = match[1];
          if (noteMatch) {
            const note = noteMatch.trim();
            if (!emittedNotes.has(note)) {
              emittedNotes.add(note);
              onProgress(note);
            }
          }
        }
      }
    }
  }

  return fullText;
}
