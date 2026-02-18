import { useState, useEffect, useRef, useCallback } from 'react';
import { SectionWrapper } from './SectionWrapper';

interface AnnotationSectionProps {
  expanded: boolean;
  onToggle: () => void;
  onAnnotate: (content: string) => void;
  existingAnnotation?: string;
  hasChanges?: boolean;
}

export function AnnotationSection({
  expanded,
  onToggle,
  onAnnotate,
  existingAnnotation = '',
  hasChanges = false,
}: AnnotationSectionProps) {
  const [note, setNote] = useState(existingAnnotation);
  const [isSaved, setIsSaved] = useState(!!existingAnnotation);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize with existing annotation
  useEffect(() => {
    setNote(existingAnnotation);
    setIsSaved(!!existingAnnotation);
  }, [existingAnnotation]);

  // Auto-save with debounce
  const handleChange = useCallback((value: string) => {
    setNote(value);
    setIsSaved(false);

    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Auto-save after 500ms of no typing
    if (value.trim()) {
      debounceRef.current = setTimeout(() => {
        onAnnotate(value.trim());
        setIsSaved(true);
      }, 500);
    }
  }, [onAnnotate]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Save immediately on blur if there's unsaved content
  const handleBlur = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (note.trim() && !isSaved) {
      onAnnotate(note.trim());
      setIsSaved(true);
    }
  };

  const showActiveState = !!(note.trim() && isSaved);

  return (
    <SectionWrapper 
      title="Annotation" 
      expanded={expanded} 
      onToggle={onToggle}
      hasChanges={hasChanges || showActiveState}
    >
      <div
        style={{
          position: 'relative',
          borderRadius: '4px',
          border: `1px solid ${showActiveState ? '#3b82f6' : '#e4e4e7'}`,
          backgroundColor: showActiveState ? '#eff6ff' : '#ffffff',
          transition: 'all 0.15s ease',
        }}
      >
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add a note about this element..."
          style={{
            width: '100%',
            minHeight: '60px',
            padding: '8px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: 'transparent',
            color: '#18181b',
            fontSize: '11px',
            resize: 'vertical',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none',
          }}
        />
        {/* Save indicator */}
        {note.trim() && (
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              right: '4px',
              fontSize: '9px',
              color: isSaved ? '#3b82f6' : '#a1a1aa',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            {isSaved ? (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </>
            ) : (
              'Saving...'
            )}
          </div>
        )}
      </div>
    </SectionWrapper>
  );
}
