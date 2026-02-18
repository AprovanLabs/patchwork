import { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EditHistoryEntry } from './types';

interface EditHistoryProps {
  entries: EditHistoryEntry[];
  streamingNotes: string[];
  isStreaming: boolean;
  pendingPrompt?: string | null;
  className?: string;
}

function ProgressNote({ text, isLatest }: { text: string; isLatest?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground/60">
      {isLatest && <Loader2 className="h-3 w-3 animate-spin" />}
      <p className="text-xs italic">{text}</p>
    </div>
  );
}

export function EditHistory({
  entries,
  streamingNotes,
  isStreaming,
  pendingPrompt,
  className = '',
}: EditHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, streamingNotes, pendingPrompt]);

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto p-4 space-y-4 bg-background ${className}`}
    >
      {entries.map((entry, i) => (
        <div key={i} className="space-y-3">
          <div className="flex justify-end">
            <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[85%]">
              <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <Markdown remarkPlugins={[remarkGfm]}>{entry.prompt}</Markdown>
              </div>
            </div>
          </div>

          <div className="flex justify-start">
            <div className="bg-primary/10 rounded-lg px-4 py-2 max-w-[85%]">
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <Markdown remarkPlugins={[remarkGfm]}>{entry.summary}</Markdown>
              </div>
            </div>
          </div>
        </div>
      ))}

      {pendingPrompt && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[85%]">
              <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                <Markdown remarkPlugins={[remarkGfm]}>{pendingPrompt}</Markdown>
              </div>
            </div>
          </div>

          {isStreaming && streamingNotes.length > 0 && (
            <div className="space-y-1 py-2 px-3">
              {streamingNotes.map((note, i) => (
                <ProgressNote
                  key={i}
                  text={note}
                  isLatest={i === streamingNotes.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
