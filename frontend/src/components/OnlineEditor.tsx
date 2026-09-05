import { useEffect, useId, useRef } from 'react';
import { OnlyOfficeConfig } from '../api/documentEditing';

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (containerId: string, config: OnlyOfficeConfig) => { destroyEditor: () => void };
    };
  }
}

const DOCUMENT_SERVER_URL = import.meta.env.VITE_ONLYOFFICE_DOCUMENT_SERVER_URL as string;

let apiScriptPromise: Promise<void> | null = null;

function loadOnlyOfficeApi(): Promise<void> {
  if (window.DocsAPI) {
    return Promise.resolve();
  }
  if (!apiScriptPromise) {
    apiScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${DOCUMENT_SERVER_URL}/web-apps/apps/api/documents/api.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the document editor'));
      document.body.appendChild(script);
    });
  }
  return apiScriptPromise;
}

interface OnlineEditorProps {
  config: OnlyOfficeConfig;
  onError: (message: string) => void;
}

export function OnlineEditor({ config, onError }: OnlineEditorProps) {
  const containerId = `oo-editor-${useId().replace(/:/g, '')}`;
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadOnlyOfficeApi()
      .then(() => {
        if (cancelled || !window.DocsAPI) return;
        editorRef.current = new window.DocsAPI.DocEditor(containerId, config);
      })
      .catch(() => onError('Could not load the document editor. Is the editor service running?'));

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
    // Re-run only if the resource being edited actually changes (its key
    // changes every save), not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.document.key]);

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="border-b px-4 py-2">
        <span className="text-sm font-medium">Editing: {config.document.title}</span>
      </div>
      <div id={containerId} className="flex-1" />
    </div>
  );
}
