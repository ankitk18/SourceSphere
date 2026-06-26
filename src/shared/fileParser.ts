/**
 * Shared file-parsing constants and types used by both the web UI and the CLI.
 */

/**
 * Represents a single file extracted from a local project folder.
 */
export interface ProjectFile {
  /** Relative path within the selected folder (e.g. src/components/Button.tsx). */
  path: string;
  /** Raw text content of the file. */
  content: string;
}

/**
 * Default set of readable code file extensions.
 */
export const DEFAULT_CODE_EXTENSIONS = new Set([
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

/**
 * Binary-ish extensions we explicitly skip to avoid reading non-text files.
 */
export const DEFAULT_IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svgz',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);

/**
 * Directories that should be skipped by default (dependency caches, build output, etc.).
 */
export const DEFAULT_IGNORED_DIRS = new Set([
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

export interface ParseOptions {
  /** File extensions to include (lowercase, with leading dot). */
  includeExtensions?: Set<string>;
  /** File extensions to exclude. */
  excludeExtensions?: Set<string>;
  /** Directory names to skip entirely. */
  ignoreDirs?: Set<string>;
  /** Maximum file size in bytes (default 2 MB). */
  maxFileSize?: number;
}

export function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isReadableFile(
  name: string,
  size: number,
  options: Required<Pick<ParseOptions, 'includeExtensions' | 'excludeExtensions' | 'maxFileSize'>>
): boolean {
  const ext = getExtension(name);
  if (!options.includeExtensions.has(ext) || options.excludeExtensions.has(ext)) return false;
  if (size === 0 || size > options.maxFileSize) return false;
  return true;
}
