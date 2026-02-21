import { useState, useEffect } from 'react';
import { FileImage, FileVideo, AlertCircle } from 'lucide-react';
import { isImageFile, isVideoFile } from './fileTypes';

export interface MediaPreviewProps {
  content: string;
  mimeType: string;
  fileName: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDataUrl(content: string, mimeType: string): string {
  if (content.startsWith('data:')) {
    return content;
  }
  return `data:${mimeType};base64,${content}`;
}

export function MediaPreview({ content, mimeType, fileName }: MediaPreviewProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataUrl = getDataUrl(content, mimeType);
  const isImage = isImageFile(fileName);
  const isVideo = isVideoFile(fileName);
  const contentSize = content.length;
  const estimatedBytes = content.startsWith('data:')
    ? Math.floor((content.split(',')[1]?.length ?? 0) * 0.75)
    : Math.floor(content.length * 0.75);

  useEffect(() => {
    setDimensions(null);
    setError(null);

    if (isImage) {
      const img = new Image();
      img.onload = () => {
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        setError('Failed to load image');
      };
      img.src = dataUrl;
    }
  }, [dataUrl, isImage]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mb-4 text-destructive" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-muted/20">
      <div className="flex-1 flex items-center justify-center w-full max-h-[60vh] overflow-hidden">
        {isImage && (
          <img
            src={dataUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded shadow-sm"
            style={{ maxHeight: 'calc(60vh - 2rem)' }}
          />
        )}
        {isVideo && (
          <video
            src={dataUrl}
            controls
            className="max-w-full max-h-full rounded shadow-sm"
            style={{ maxHeight: 'calc(60vh - 2rem)' }}
          >
            Your browser does not support video playback.
          </video>
        )}
        {!isImage && !isVideo && (
          <div className="flex flex-col items-center text-muted-foreground">
            <FileImage className="h-16 w-16 mb-4" />
            <p className="text-sm">Preview not available for this file type</p>
          </div>
        )}
      </div>

      <div className="mt-6 text-center text-sm text-muted-foreground space-y-1">
        <div className="flex items-center justify-center gap-2">
          {isImage && <FileImage className="h-4 w-4" />}
          {isVideo && <FileVideo className="h-4 w-4" />}
          <span className="font-medium">{fileName}</span>
        </div>
        <div className="text-xs space-x-3">
          {dimensions && (
            <span>{dimensions.width} × {dimensions.height} px</span>
          )}
          <span>{formatFileSize(estimatedBytes)}</span>
          <span className="text-muted-foreground/60">{mimeType}</span>
        </div>
      </div>
    </div>
  );
}
