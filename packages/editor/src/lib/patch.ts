/**
 * Conversation-level resolution of diff-based widget edits.
 *
 * Revisions arrive as ```patch path="main.tsx"``` (or legacy ```diff```)
 * fences containing SEARCH/REPLACE hunks — parsing and application reuse
 * lib/diff.ts. This module adds the folding step: walking a conversation's
 * assistant messages in order, tracking each path's current source, applying
 * patch fences, and rewriting them into full code fences so downstream
 * rendering (CodePreview etc.) never sees a diff.
 *
 * This is generic file editing, not Patchwork-specific: hunks apply to any
 * text file by exact match.
 */

import { extractCodeBlocks, type CodePart } from './code-extractor';
import { applyDiffs, parseDiffs } from './diff';

const PATCH_LANGUAGES = new Set(['patch', 'diff']);

function serializeFence(part: CodePart): string {
  const attrs = Object.entries(part.attributes ?? {})
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');
  const content = part.content.endsWith('\n') ? part.content : part.content + '\n';
  return `\`\`\`${part.language}${attrs}\n${content}\`\`\``;
}

/**
 * Resolve patch blocks in one assistant message against the accumulated
 * per-path sources, mutating `sources` as it goes:
 *
 * - full code fences with a `path` update `sources`;
 * - patch fences apply to `sources` and are rewritten into a full fence of
 *   the patched file;
 * - a hunk that fails to apply leaves the block untouched — the raw patch
 *   stays visible instead of silently corrupting the widget.
 *
 * Fold conversation messages in order through this function (one shared
 * `sources` map) to reconstruct every widget's current source.
 */
export function resolvePatchesInText(
  text: string,
  sources: Map<string, string>,
): string {
  const parts = extractCodeBlocks(text);
  if (!parts.some((p) => p.type === 'code')) return text;

  return parts
    .map((part) => {
      if (part.type !== 'code') return part.content;
      const codePart = part as CodePart;
      const path = codePart.attributes?.path;

      if (path && PATCH_LANGUAGES.has(codePart.language)) {
        const base = sources.get(path);
        const hunks = base !== undefined ? parseDiffs(codePart.content) : [];
        if (hunks.length > 0) {
          const { code, failed } = applyDiffs(base!, hunks);
          if (failed.length === 0) {
            sources.set(path, code);
            return serializeFence({ ...codePart, language: 'tsx', content: code });
          }
        }
        return serializeFence(codePart);
      }

      if (path) sources.set(path, codePart.content);
      return serializeFence(codePart);
    })
    .join('\n\n');
}
