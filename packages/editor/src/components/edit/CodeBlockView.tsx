import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';

// Singleton highlighter instance
let highlighterPromise: Promise<Highlighter> | null = null;

const COMMON_LANGUAGES: BundledLanguage[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'html',
  'css',
  'markdown',
  'yaml',
  'python',
  'bash',
  'sql',
];

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light'],
      langs: COMMON_LANGUAGES,
    });
  }
  return highlighterPromise;
}

// Map common file extensions/language names to shiki language identifiers
function normalizeLanguage(lang: string | null): BundledLanguage {
  if (!lang) return 'typescript';
  const normalized = lang.toLowerCase();
  const mapping: Record<string, BundledLanguage> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    markdown: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    py: 'python',
    python: 'python',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
    typescript: 'typescript',
    javascript: 'javascript',
  };
  return mapping[normalized] || 'typescript';
}

export interface CodeBlockViewProps {
  content: string;
  language: string | null;
  editable?: boolean;
  onChange?: (content: string) => void;
}

export function CodeBlockView({ content, language, editable = false, onChange }: CodeBlockViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  // Load the highlighter
  useEffect(() => {
    let mounted = true;
    getHighlighter().then((h) => {
      if (mounted) setHighlighter(h);
    });
    return () => { mounted = false; };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(e.target.value);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const target = e.target as HTMLTextAreaElement;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        onChange?.(newValue);
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
    },
    [onChange]
  );

  const langLabel = language || 'text';
  const shikiLang = useMemo(() => normalizeLanguage(language), [language]);

  // Generate highlighted HTML
  const highlightedHtml = useMemo(() => {
    if (!highlighter) return null;
    try {
      return highlighter.codeToHtml(content, {
        lang: shikiLang,
        theme: 'github-light',
      });
    } catch {
      // Fallback if language is not supported
      return null;
    }
  }, [highlighter, content, shikiLang]);

  return (
    <div className="h-full flex flex-col bg-[#ffffff]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#f6f8fa] border-b border-[#d0d7de] text-xs">
        <span className="font-mono text-[#57606a]">{langLabel}</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {editable ? (
          <div className="relative min-h-full">
            {/* Highlighted code layer (background) - scrolls with content */}
            <div
              ref={containerRef}
              className="absolute top-0 left-0 right-0 pointer-events-none p-4"
              aria-hidden="true"
            >
              {highlightedHtml ? (
                <div
                  className="highlighted-code font-mono text-xs leading-relaxed whitespace-pre-wrap break-words [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_pre]:whitespace-pre-wrap [&_code]:!bg-transparent [&_code]:whitespace-pre-wrap [&_code]:break-words"
                  dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                />
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-words text-[#24292f] m-0 leading-relaxed">
                  <code>{content}</code>
                </pre>
              )}
            </div>
            {/* Editable textarea layer (foreground) */}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              className="relative w-full min-h-full font-mono text-xs leading-relaxed bg-transparent border-none outline-none resize-none p-4 text-transparent whitespace-pre-wrap break-words"
              spellCheck={false}
              style={{
                tabSize: 2,
                caretColor: '#24292f',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            />
          </div>
        ) : (
          <div className="p-4">
            {highlightedHtml ? (
              <div
                className="highlighted-code font-mono text-xs leading-relaxed whitespace-pre-wrap break-words [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_pre]:whitespace-pre-wrap [&_code]:!bg-transparent [&_code]:whitespace-pre-wrap [&_code]:break-words"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 leading-relaxed text-[#24292f]">
                <code>{content}</code>
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
