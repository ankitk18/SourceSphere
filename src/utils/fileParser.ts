// Re-export shared file-parsing constants and types for browser-specific code.
import type { ProjectFile } from '@/shared/fileParser';
export type { ProjectFile, ParseOptions } from '@/shared/fileParser';
export {
  DEFAULT_CODE_EXTENSIONS,
  DEFAULT_IGNORED_EXTENSIONS,
  DEFAULT_IGNORED_DIRS,
  getExtension,
} from '@/shared/fileParser';

const DEFAULT_CODE_EXTENSIONS = new Set([
  // JavaScript / TypeScript ecosystem
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  // Python
  '.py', '.pyw',
  // Java
  '.java', '.kt',
  // C / C++ / C# / Objective-C
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs', '.m', '.mm',
  // Web & markup
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.svg',
  // Data & config
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  // Shell & systems
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  // Other common source files
  '.go', '.rs', '.rb', '.php', '.swift', '.r', '.lua', '.pl', '.scala',
  '.sql', '.md', '.txt', '.log',
]);

const DEFAULT_IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svgz',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.vscode',
  '.idea',
  '__pycache__',
  'venv',
  '.venv',
  'coverage',
]);

interface ParseOptions {
  includeExtensions?: Set<string>;
  excludeExtensions?: Set<string>;
  ignoreDirs?: Set<string>;
  maxFileSize?: number;
}

/**
 * Recursively parse a list of FileSystemEntry items (from webkitdirectory or drag-and-drop)
 * into ProjectFile objects containing path and raw text content.
 */
export async function parseProjectEntries(
  entries: FileSystemEntry[],
  options: ParseOptions = {}
): Promise<ProjectFile[]> {
  const {
    includeExtensions = DEFAULT_CODE_EXTENSIONS,
    excludeExtensions = DEFAULT_IGNORED_EXTENSIONS,
    ignoreDirs = DEFAULT_IGNORED_DIRS,
    maxFileSize = 2 * 1024 * 1024,
  } = options;

  const results: ProjectFile[] = [];

  async function traverse(entry: FileSystemEntry, pathPrefix: string) {
    const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      if (ignoreDirs.has(entry.name)) return;

      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const childEntries = await readAllEntries(dirReader);
      await Promise.all(childEntries.map((child) => traverse(child, currentPath)));
      return;
    }

    if (entry.isFile) {
      const ext = _getExtension(entry.name);
      if (!includeExtensions.has(ext) || excludeExtensions.has(ext)) return;

      const file = await getFileFromEntry(entry as FileSystemFileEntry);
      if (!file || file.size === 0 || file.size > maxFileSize) return;

      try {
        const content = await file.text();
        results.push({ path: currentPath, content });
      } catch (err) {
        // Skip files that cannot be read as text.
        console.warn(`Could not read file: ${currentPath}`, err);
      }
    }
  }

  await Promise.all(entries.map((entry) => traverse(entry, '')));

  // Stable ordering makes UI deterministic.
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Convert a DataTransferItemList (from drag-and-drop) into FileSystemEntry objects.
 */
export function dataTransferItemsToEntries(items: DataTransferItemList): FileSystemEntry[] {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Convert a FileList (from a file input) into FileSystemEntry objects via webkitRelativePath.
 */
export function fileListToEntries(fileList: FileList | null): FileSystemEntry[] {
  if (!fileList || fileList.length === 0) return [];

  // Use the first file's relative path to find the root folder name.
  const firstFile = fileList[0];
  const rootFolder = firstFile.webkitRelativePath.split('/')[0];

  // Build a tree of virtual entries from the flat FileList.
  const root: VirtualDirectory = { name: rootFolder, kind: 'directory', children: new Map() };

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const parts = file.webkitRelativePath.split('/');
    let current: VirtualDirectory = root;

    for (let j = 1; j < parts.length; j++) {
      const part = parts[j];
      const isFile = j === parts.length - 1;

      if (isFile) {
        current.children.set(part, { name: part, kind: 'file', file });
      } else {
        let next = current.children.get(part) as VirtualDirectory | undefined;
        if (!next) {
          next = { name: part, kind: 'directory', children: new Map() };
          current.children.set(part, next);
        }
        current = next;
      }
    }
  }

  return virtualEntriesToFileSystemEntries(root.children);
}

/**
 * Parse a list of File objects (for example from a multi-file input) into ProjectFile objects.
 * This is a simpler fallback that doesn't require the File System Access API.
 */
export async function parseFileList(
  fileList: FileList | null,
  options: ParseOptions = {}
): Promise<ProjectFile[]> {
  if (!fileList || fileList.length === 0) return [];

  const {
    includeExtensions = DEFAULT_CODE_EXTENSIONS,
    excludeExtensions = DEFAULT_IGNORED_EXTENSIONS,
    maxFileSize = 2 * 1024 * 1024,
  } = options;

  const results: ProjectFile[] = [];

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const ext = _getExtension(file.name);
    if (!includeExtensions.has(ext) || excludeExtensions.has(ext)) continue;
    if (file.size === 0 || file.size > maxFileSize) continue;

    try {
      const content = await file.text();
      const path = file.webkitRelativePath || file.name;
      results.push({ path, content });
    } catch (err) {
      console.warn(`Could not read file: ${file.name}`, err);
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

interface VirtualDirectory {
  name: string;
  kind: 'directory';
  children: Map<string, VirtualEntry>;
}

interface VirtualFile {
  name: string;
  kind: 'file';
  file: File;
}

type VirtualEntry = VirtualDirectory | VirtualFile;

function virtualEntriesToFileSystemEntries(children: Map<string, VirtualEntry>): FileSystemEntry[] {
  return Array.from(children.values()).map((entry) => {
    if (entry.kind === 'file') {
      return createFileSystemFileEntry(entry.file);
    }
    return createFileSystemDirectoryEntry(entry.name, entry.children);
  });
}

function createFileSystemFileEntry(file: File): FileSystemFileEntry {
  return {
    name: file.name,
    isDirectory: false,
    isFile: true,
    file: (successCallback) => successCallback(file),
  } as FileSystemFileEntry;
}

function createFileSystemDirectoryEntry(
  name: string,
  children: Map<string, VirtualEntry>
): FileSystemDirectoryEntry {
  const childEntries = virtualEntriesToFileSystemEntries(children);

  return {
    name,
    isDirectory: true,
    isFile: false,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (successCallback) => {
          const batch = childEntries.slice(index, index + 100);
          index += batch.length;
          successCallback(batch);
        },
      } as FileSystemDirectoryReader;
    },
  } as FileSystemDirectoryEntry;
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];

    function readBatch() {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        (err) => reject(err)
      );
    }

    readBatch();
  });
}

function getFileFromEntry(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => entry.file((file) => resolve(file)));
}
function _getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}
