'use client';

import { useCallback, useRef, useState } from 'react';
import {
  dataTransferItemsToEntries,
  fileListToEntries,
  parseFileList,
  parseProjectEntries,
  ProjectFile,
} from '@/utils/fileParser';

interface FileDropzoneProps {
  /** Called when files have been parsed from the selected folder. */
  onDrop: (files: ProjectFile[]) => void | Promise<void>;
  /** Whether the consumer is currently processing the dropped files. */
  isLoading?: boolean;
}

export default function FileDropzone({ onDrop, isLoading = false }: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [folderName, setFolderName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const parseAndEmit = useCallback(
    async (entries: FileSystemEntry[], name: string | null) => {
      try {
        const projectFiles = await parseProjectEntries(entries);
        setFolderName(name);
        await onDrop(projectFiles);
      } catch (err) {
        console.error('Failed to parse folder:', err);
      }
    },
    [onDrop]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (isLoading) return;

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      const entries = dataTransferItemsToEntries(items);
      if (entries.length === 0) return;

      const name = entries.length === 1 && entries[0].isDirectory ? entries[0].name : null;
      await parseAndEmit(entries, name);
    },
    [isLoading, parseAndEmit]
  );

  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // Prefer the File System Access API representation when available (webkitdirectory input).
      const entries = fileListToEntries(files);
      if (entries.length > 0) {
        const name = files[0]?.webkitRelativePath.split('/')[0] ?? null;
        await parseAndEmit(entries, name);
      } else {
        // Fallback for plain multi-file inputs.
        const parsed = await parseFileList(files);
        setFolderName(null);
        await onDrop(parsed);
      }

      // Reset the input so the same folder can be selected again.
      e.target.value = '';
    },
    [onDrop, parseAndEmit]
  );

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload project folder"
        className={[
          'group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed',
          'bg-slate-900/50 px-8 py-14 text-center transition-all duration-200',
          'hover:border-indigo-400 hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950',
          isDragging ? 'border-indigo-400 bg-slate-800/80' : 'border-slate-700',
          isLoading ? 'pointer-events-none opacity-70' : '',
        ].join(' ')}
      >
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 group-hover:bg-slate-700">
          <FolderIcon className="h-8 w-8 text-indigo-400" />
        </div>

        <h3 className="mb-2 text-lg font-semibold text-white">
          {isDragging ? 'Drop folder here' : 'Upload a project folder'}
        </h3>
        <p className="max-w-md text-sm text-slate-400">
          Drag and drop a folder, or click to browse. Recursively reads .js, .py, .java, .cpp, and
          many other text/code files.
        </p>

        {isLoading && (
          <div className="mt-6 flex items-center gap-3 text-sm text-indigo-300">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Reading folder contents…
          </div>
        )}

        {folderName && !isLoading && (
          <p className="mt-4 text-sm text-emerald-400">Loaded: {folderName}</p>
        )}

        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but supported in modern browsers.
          webkitdirectory="true"
          directory=""
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      <p className="mt-3 text-center text-xs text-slate-500">
        Ignores node_modules, .git, build output, images, archives, and binaries by default.
      </p>
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}
