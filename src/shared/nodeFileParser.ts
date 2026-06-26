import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import {
  DEFAULT_CODE_EXTENSIONS,
  DEFAULT_IGNORED_DIRS,
  DEFAULT_IGNORED_EXTENSIONS,
  getExtension,
  ParseOptions,
  ProjectFile,
} from '../shared/fileParser';

/**
 * Recursively walk a local directory and read all readable code files into
 * ProjectFile objects. Designed for the Node.js CLI.
 */
export async function parseDirectory(
  rootDir: string,
  options: ParseOptions = {}
): Promise<ProjectFile[]> {
  const {
    includeExtensions = DEFAULT_CODE_EXTENSIONS,
    excludeExtensions = DEFAULT_IGNORED_EXTENSIONS,
    ignoreDirs = DEFAULT_IGNORED_DIRS,
    maxFileSize = 2 * 1024 * 1024,
  } = options;

  const results: ProjectFile[] = [];

  async function traverse(dirPath: string, relativePrefix: string) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      console.warn(`Could not read directory: ${dirPath}`, err);
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        const nextRelative = relativePrefix
          ? `${relativePrefix}/${entry.name}`
          : entry.name;
        await traverse(path.join(dirPath, entry.name), nextRelative);
      } else if (entry.isFile()) {
        const ext = getExtension(entry.name);
        if (!includeExtensions.has(ext) || excludeExtensions.has(ext)) continue;

        const filePath = path.join(dirPath, entry.name);
        const relativePath = relativePrefix
          ? `${relativePrefix}/${entry.name}`
          : entry.name;

        try {
          const stat = await fs.stat(filePath);
          if (stat.size === 0 || stat.size > maxFileSize) continue;
          const content = await fs.readFile(filePath, 'utf-8');
          results.push({ path: relativePath, content });
        } catch (err) {
          console.warn(`Could not read file: ${filePath}`, err);
        }
      }
    }
  }

  await traverse(rootDir, '');
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
