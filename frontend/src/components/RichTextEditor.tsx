import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
  title: string;
  initialContent: unknown;
  editable: boolean;
  saving?: boolean;
  onSave?: (content: unknown) => void;
  onChange?: (content: unknown) => void;
}

export function RichTextEditor({ title, initialContent, editable, saving, onSave, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (initialContent as object) ?? '',
    editable,
    onUpdate: ({ editor: updatedEditor }) => {
      onChange?.(updatedEditor.getJSON());
    },
  });

  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) {
    return null;
  }

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">{editable ? 'Editing' : 'Viewing'}: {title}</span>
        {editable && onSave && (
          <button
            onClick={() => onSave(editor.getJSON())}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
      <div className="prose max-w-none flex-1 overflow-auto p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
