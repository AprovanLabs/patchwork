export interface SaveConfirmDialogProps {
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function SaveConfirmDialog({
  isOpen,
  isSaving,
  error,
  onSave,
  onDiscard,
  onCancel,
}: SaveConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-md">
        <div className="p-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Unsaved Changes
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            You have unsaved changes. Would you like to save them before closing?
          </p>
          {error && (
            <p className="text-sm text-destructive mt-3">Save failed: {error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 p-6 pt-0">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 border border-input bg-background text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
