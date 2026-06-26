/**
 * Generic embedding provider interface. Both the web UI and the CLI work
 * against this abstraction, so switching between local Xenova and an
 * OpenAI-compatible API only requires swapping the implementation.
 */
import { ProjectFile } from '../fileParser';

export interface EmbeddingProvider {
  /** Human-readable provider name (for UI/CLI messages). */
  readonly name: string;

  /**
   * Embed a batch of code files. Should return results in the same order as
   * the input array.
   */
  embedFiles(
    files: ProjectFile[],
    onProgress?: (index: number, total: number, path: string, attempt?: number) => void
  ): Promise<FileEmbedding[]>;

  /** Embed a single natural-language query string. */
  embedQuery(query: string): Promise<number[]>;
}

export interface FileEmbedding {
  /** Relative file path. */
  path: string;
  /** Embedding vector (dimension depends on the model/provider). */
  embedding: number[];
}
