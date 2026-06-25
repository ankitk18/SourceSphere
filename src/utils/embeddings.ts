import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { ProjectFile } from './fileParser';

/**
 * A single embedding result for one file.
 */
export interface FileEmbedding {
  /** Relative file path. */
  path: string;
  /** 384-dimensional floating-point embedding vector. */
  embedding: number[];
}

let embeddingPipeline: FeatureExtractionPipeline | null = null;

/**
 * Lazily create (and cache) a sentence-similarity embedding pipeline using
 * Xenova/all-MiniLM-L6-v2. The model runs entirely in the browser via ONNX
 * Runtime. It is smaller and faster than all-mpnet-base-v2, so it keeps the UI
 * responsive on typical machines.
 */
export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      {
        // Use WebGL/WebGPU when available; falls back to WASM/CPU.
        quantized: false,
      }
    );
  }
  return embeddingPipeline;
}

/**
 * Build the embedding input for a code file. The path is prepended because
 * directory and filename tokens (e.g. `db/connection.py`, `auth/login.js`)
 * carry strong semantic signal that the model can use to answer queries like
 * "where is the database connection handled?".
 */
function buildEmbeddingInput(path: string, content: string): string {
  const trimmedContent = content.trim().slice(0, 5000);
  // Format: path on its own line, then a small prefix, then the code.
  return `File: ${path}\n\n${trimmedContent}`;
}

/**
 * Generate 384-dimensional embeddings for an array of ProjectFile objects.
 *
 * @param files - Array of { path, content } objects.
 * @param onProgress - Optional callback invoked after each file is embedded.
 * @returns Array of { path, embedding } objects in the same order as the input.
 */
export async function generateEmbeddings(
  files: ProjectFile[],
  onProgress?: (index: number, total: number, path: string) => void
): Promise<FileEmbedding[]> {
  if (files.length === 0) return [];

  const embedder = await getEmbeddingPipeline();
  const results: FileEmbedding[] = [];

  for (let i = 0; i < files.length; i++) {
    const { path, content } = files[i];

    // Embed the path together with the code so directory/filename semantics
    // help route natural-language queries to the right files.
    const input = buildEmbeddingInput(path, content);

    // Run feature extraction. mean_pooling + normalization gives a single
    // 384-dimensional vector per input.
    const output = await embedder(input, {
      pooling: 'mean',
      normalize: true,
    });

    // output.data may be a plain array or a TypedArray depending on the runtime.
    const data = output.data as number[] | Float32Array;
    const embedding = Array.isArray(data) ? data : Array.from(data);

    // all-MiniLM-L6-v2 returns a 384-dimensional vector.
    if (embedding.length !== 384) {
      console.warn(`Unexpected embedding length for ${path}: ${embedding.length}`);
    }

    results.push({ path, embedding });
    onProgress?.(i + 1, files.length, path);
  }

  return results;
}

/**
 * Generate a normalized 384-dimensional embedding vector for an arbitrary
 * natural-language query string.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const embedder = await getEmbeddingPipeline();
  const output = await embedder(query.trim().slice(0, 5000), {
    pooling: 'mean',
    normalize: true,
  });
  const data = output.data as number[] | Float32Array;
  return Array.isArray(data) ? data : Array.from(data);
}

/**
 * Compute cosine similarity between two normalized vectors.
 * Vectors do not need to be unit length, but normalized vectors make this a
 * simple dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Score every file embedding against a query embedding and return the top K
 * matches sorted by cosine similarity.
 *
 * @param minScore - Matches with similarity below this threshold are dropped.
 *   Default 0.35 filters obvious false positives while still allowing
 *   medium-confidence matches.
 */
export function findTopMatches(
  queryEmbedding: number[],
  fileEmbeddings: FileEmbedding[],
  topK = 5,
  minScore = 0.35
): Array<{ path: string; embedding: number[]; score: number; index: number }> {
  const scored = fileEmbeddings.map((file, index) => ({
    path: file.path,
    embedding: file.embedding,
    score: cosineSimilarity(queryEmbedding, file.embedding),
    index,
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored.filter((m) => m.score >= minScore).slice(0, topK);
}

/**
 * Convenience helper: given a ProjectFile[], returns a plain array of vectors only.
 */
export async function generateEmbeddingVectors(
  files: ProjectFile[]
): Promise<number[][]> {
  const embeddings = await generateEmbeddings(files);
  return embeddings.map((e) => e.embedding);
}
