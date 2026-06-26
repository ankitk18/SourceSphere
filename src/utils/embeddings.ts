import { EmbeddingProvider, FileEmbedding } from '@/shared/providers/EmbeddingProvider';
import { ProjectFile } from '@/shared/fileParser';
import { XenovaProvider, XenovaProviderOptions } from '@/shared/providers/XenovaProvider';
import {
  OpenAICompatibleProvider,
  OpenAICompatibleProviderOptions,
} from '@/shared/providers/OpenAICompatibleProvider';
import { cosineSimilarity, expandQuery, findTopMatches, keywordSearch } from '@/shared/search';

export type { FileEmbedding } from '@/shared/providers/EmbeddingProvider';
export { cosineSimilarity, expandQuery, findTopMatches, keywordSearch };

let currentProvider: EmbeddingProvider | null = null;

/** Switch the global embedding provider used by generateEmbeddings/generateQueryEmbedding. */
export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  currentProvider = provider;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!currentProvider) {
    currentProvider = new XenovaProvider();
  }
  return currentProvider;
}

/** Convenience factory for the default local Xenova provider. */
export function createXenovaProvider(options?: XenovaProviderOptions): XenovaProvider {
  return new XenovaProvider(options);
}

/** Convenience factory for any OpenAI-compatible API provider. */
export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(options);
}

/**
 * Generate embeddings for an array of ProjectFile objects using the currently
 * selected provider (Xenova by default).
 */
export async function generateEmbeddings(
  files: ProjectFile[],
  onProgress?: (index: number, total: number, path: string, attempt?: number) => void
): Promise<FileEmbedding[]> {
  return getEmbeddingProvider().embedFiles(files, onProgress);
}

/**
 * Generate an embedding vector for a natural-language query using the currently
 * selected provider (Xenova by default).
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  return getEmbeddingProvider().embedQuery(query);
}

/**
 * Convenience helper: given a ProjectFile[], returns a plain array of vectors only.
 */
export async function generateEmbeddingVectors(files: ProjectFile[]): Promise<number[][]> {
  const embeddings = await generateEmbeddings(files);
  return embeddings.map((e) => e.embedding);
}

/**
 * Generate embeddings for an array of ProjectFile objects using a specific provider.
 * Useful when you don't want to mutate the global provider state.
 */
export async function generateEmbeddingsWithProvider(
  provider: EmbeddingProvider,
  files: ProjectFile[],
  onProgress?: (index: number, total: number, path: string, attempt?: number) => void
): Promise<FileEmbedding[]> {
  return provider.embedFiles(files, onProgress);
}
