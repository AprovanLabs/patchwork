import { AlertTriangle, Loader2, Save } from 'lucide-react';

export type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error';

interface SaveStatusButtonProps {
  status: SaveStatus;
  onClick: () => void;
  disabled?: boolean;
  tone: 'muted' | 'primary';
}

function getToneClass(tone: 'muted' | 'primary', status: SaveStatus): string {
  if (status === 'error') {
    return tone === 'muted'
      ? 'text-destructive hover:bg-muted'
      : 'text-destructive hover:bg-destructive/10';
  }

  if (status === 'saved') {
    return tone === 'muted'
      ? 'text-muted-foreground/50 hover:bg-muted'
      : 'text-primary/50 hover:bg-primary/10';
  }

  return tone === 'muted'
    ? 'text-muted-foreground hover:bg-muted'
    : 'text-primary hover:bg-primary/20';
}

export function SaveStatusButton({
  status,
  onClick,
  disabled = false,
  tone,
}: SaveStatusButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 text-xs rounded flex items-center gap-1 disabled:opacity-50 ${getToneClass(tone, status)}`}
      title="Save"
    >
      <span className="inline-flex h-3 w-3 items-center justify-center shrink-0">
        {status === 'saving' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : status === 'error' ? (
          <AlertTriangle className="h-3 w-3" />
        ) : (
          <Save className={`h-3 w-3 ${status === 'saved' ? 'opacity-60' : 'opacity-100'}`} />
        )}
      </span>
      Save
    </button>
  );
}