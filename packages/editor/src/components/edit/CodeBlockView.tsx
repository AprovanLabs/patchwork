import { useCallback, useRef, useEffect } from 'react';

export interface CodeBlockViewProps {
  content: string;
  language: string | null;
  editable?: boolean;
  onChange?: (content: string) => void;
}

export function CodeBlockView({ content, language, editable = false, onChange }: CodeBlockViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  return (
    <div className="h-full flex flex-col bg-muted/10">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b text-xs">
        <span className="font-mono text-muted-foreground">{langLabel}</span>
      </div>
        {editable ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className="w-full min-h-full font-mono text-xs leading-relaxed bg-transparent border-none outline-none resize-none"
            spellCheck={false}
            style={{
              tabSize: 2,
              WebkitTextFillColor: 'inherit',
            }}
          />
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 leading-relaxed">
            <code>{content}</code>
          </pre>
        )}
    </div>
  );
}
