import type { VirtualFile, VirtualProject } from '@aprovan/patchwork-compiler';
import { createProjectFromFiles, detectMainFile } from '@aprovan/patchwork-compiler';

// Matches fenced code blocks with optional attributes: ```language attr="value"\n...content...```
// Captures: [1] = language (optional), [2] = attributes (optional), [3] = content
const CODE_BLOCK_REGEX = /```([a-zA-Z0-9_+-]*)((?:\s+[a-zA-Z_][\w-]*="[^"]*")*)\s*\n([\s\S]*?)```/g;

// Matches an unclosed code block at the end (streaming case)
const UNCLOSED_BLOCK_REGEX = /```([a-zA-Z0-9_+-]*)((?:\s+[a-zA-Z_][\w-]*="[^"]*")*)\s*\n([\s\S]*)$/;

// Parse attributes from string like: note="value" path="@/foo.tsx"
const ATTRIBUTE_REGEX = /([a-zA-Z_][\w-]*)="([^"]*)"/g;

export type TextPart = { type: 'text'; content: string };
export type CodePart = { 
  type: 'code' | string; 
  content: string; 
  language: 'jsx' | 'tsx' | string;
  attributes?: Record<string, string>;
};
export type ParsedPart = TextPart | CodePart;

export interface ExtractOptions {
  /** Only extract these languages (default: all) */
  filterLanguages?: Set<string>;
  /** Include unclosed code blocks at the end (for streaming) */
  includeUnclosed?: boolean;
}

/**
 * Parse attributes string into key-value pairs.
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!attrString) return attrs;
  
  const regex = new RegExp(ATTRIBUTE_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}

/**
 * Extract code blocks from markdown text.
 */
export function extractCodeBlocks(
  text: string,
  options: ExtractOptions = {}
): ParsedPart[] {
  const { filterLanguages, includeUnclosed = false } = options;
  const parts: ParsedPart[] = [];
  let lastIndex = 0;

  // First pass: find all code blocks and track their positions
  const allMatches: Array<{ 
    match: RegExpExecArray; 
    language: string; 
    content: string; 
    attributes: Record<string, string>;
    included: boolean;
  }> = [];
  const regex = new RegExp(CODE_BLOCK_REGEX.source, 'g');
  let match;

  while ((match = regex.exec(text)) !== null) {
    const language = match[1]?.toLowerCase() || '';
    const attributes = parseAttributes(match[2] || '');
    const content = match[3] ?? '';
    const included = !filterLanguages || filterLanguages.has(language);
    allMatches.push({ match, language, content, attributes, included });
  }

  // Process matches in order
  for (const { match, language, content, attributes, included } of allMatches) {
    // Add preceding text (excluding any skipped code blocks)
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    // Always advance lastIndex past this block (even if not included)
    lastIndex = match.index + match[0].length;

    // Only add the block if it passes the filter
    if (included) {
      parts.push({ type: 'code', content, language, attributes });
    }
  }

  // Check for unclosed code block at the end (streaming case)
  const remainingText = text.slice(lastIndex);
  if (includeUnclosed && remainingText.includes('```')) {
    const unclosedMatch = remainingText.match(UNCLOSED_BLOCK_REGEX);
    if (unclosedMatch) {
      const language = unclosedMatch[1]?.toLowerCase() || '';
      const attributes = parseAttributes(unclosedMatch[2] || '');
      const content = unclosedMatch[3] ?? '';
      const included = !filterLanguages || filterLanguages.has(language);
      
      // Add text before the unclosed block
      const unclosedIndex = remainingText.indexOf('```');
      if (unclosedIndex > 0) {
        const textBefore = remainingText.slice(0, unclosedIndex);
        if (textBefore.trim()) {
          parts.push({ type: 'text', content: textBefore });
        }
      }

      if (included) {
        parts.push({ type: 'code', content, language, attributes });
      }
      lastIndex = text.length; // Mark all text as processed
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) {
      parts.push({ type: 'text', content: remaining });
    }
  }

  // If no parts found, return the whole text
  if (parts.length === 0) {
    parts.push({ type: 'text', content: text });
  }

  return parts;
}

/**
 * Find the first JSX/TSX block in the text.
 * Returns null if no JSX block is found.
 */
export function findFirstCodeBlock(text: string): CodePart | null {
  const parts = extractCodeBlocks(text);
  return (parts.find((p) => p.type === 'code') as CodePart) ?? null;
}

/**
 * Check if text contains any JSX/TSX code blocks.
 */
export function hasCodeBlock(text: string): boolean {
  return findFirstCodeBlock(text) !== null;
}

/**
 * Get all unique languages found in code blocks.
 */
export function getCodeBlockLanguages(text: string): Set<string> {
  const parts = extractCodeBlocks(text);
  const languages = new Set<string>();
  for (const part of parts) {
    if (part.type === 'code') {
      languages.add(part.language);
    }
  }
  return languages;
}

/**
 * Extract code blocks as a VirtualProject.
 * Groups files with path attributes into a multi-file project.
 * Files without paths are treated as the main entry file.
 */
export function extractProject(
  text: string,
  options?: ExtractOptions
): { project: VirtualProject; textParts: TextPart[] } {
  const parts = extractCodeBlocks(text, options);

  const files: VirtualFile[] = [];
  const textParts: TextPart[] = [];

  for (const part of parts) {
    if (part.type === 'text') {
      textParts.push(part as TextPart);
    } else if (part.type === 'code') {
      const codePart = part as CodePart;
      if (codePart.attributes?.path) {
        files.push({
          path: codePart.attributes.path,
          content: codePart.content,
          language: codePart.language,
          note: codePart.attributes.note,
        });
      } else {
        files.push({
          path: detectMainFile(codePart.language),
          content: codePart.content,
          language: codePart.language,
        });
      }
    }
  }

  return {
    project: createProjectFromFiles(files),
    textParts,
  };
}
