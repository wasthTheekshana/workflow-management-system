import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ContentFormat } from '../api/templateFiles';
import { OnlyOfficeConfig } from '../api/documentEditing';
import { OnlineEditor } from './OnlineEditor';
import { RichTextEditor } from './RichTextEditor';

interface RichTextPanelProps {
  content: unknown;
  editable: boolean;
  saving?: boolean;
  onSave?: (content: unknown) => void;
}

interface DocumentPanelProps {
  format: ContentFormat;
  title: string;
  richText?: RichTextPanelProps;
  docxQueryKey?: unknown[];
  fetchDocxConfig?: () => Promise<OnlyOfficeConfig>;
  docxEnabled?: boolean;
  onError?: (message: string) => void;
}

function PanelMessage({ tone, children }: { tone: 'muted' | 'error'; children: string }) {
  const toneClass = tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-dashed border-gray-300 text-gray-500';
  return (
    <div className={`flex h-full min-h-[60vh] items-center justify-center rounded border text-sm ${toneClass}`}>
      {children}
    </div>
  );
}

export function DocumentPanel({
  format,
  title,
  richText,
  docxQueryKey,
  fetchDocxConfig,
  docxEnabled = true,
  onError,
}: DocumentPanelProps) {
  const isDocx = format === 'docx';
  const {
    data: config,
    error,
    isLoading,
  } = useQuery({
    queryKey: docxQueryKey ?? ['docxEditConfig', title],
    queryFn: fetchDocxConfig,
    enabled: isDocx && docxEnabled && Boolean(fetchDocxConfig),
  });

  useEffect(() => {
    if (isDocx && error) {
      onError?.('Could not open the editor');
    }
  }, [isDocx, error, onError]);

  if (format === 'richtext') {
    if (!richText) return null;
    return (
      <RichTextEditor
        title={title}
        initialContent={richText.content}
        editable={richText.editable}
        saving={richText.saving}
        onSave={richText.onSave}
      />
    );
  }

  if (!docxEnabled) {
    return <PanelMessage tone="muted">Upload a file to open the document editor.</PanelMessage>;
  }

  if (isLoading) {
    return <PanelMessage tone="muted">Loading editor...</PanelMessage>;
  }

  if (error || !config) {
    return <PanelMessage tone="error">Could not load the document editor.</PanelMessage>;
  }

  return <OnlineEditor config={config} onError={onError ?? (() => {})} />;
}
