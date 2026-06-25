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
 * Expand a natural-language query with code-related synonyms before embedding.
 * This helps the small all-MiniLM-L6-v2 model bridge the gap between
 * conversational phrasing and the tokens that actually appear in code.
 *
 * Example: "where is user authentication handled?" becomes richer with
 * synonyms like `auth`, `login`, `token`, `session`, `credential`, etc.
 */
function expandQuery(query: string): string {
  const terms = query.toLowerCase().split(/\s+/);
  const expansions = new Set<string>();

  const synonyms: Record<string, string[]> = {
    authentication: ['auth', 'authenticate', 'login', 'logout', 'signin', 'signout', 'token', 'session', 'credential', 'jwt'],
    authorization: ['auth', 'authorize', 'permission', 'role', 'access', 'acl', 'rbac'],
    workout: ['workouts', 'exercise', 'exercises', 'fitness', 'training'],
    database: ['db', 'database', 'connection', 'mongoose', 'prisma', 'sql', 'postgres', 'mongodb'],
    storage: ['localstorage', 'sessionstorage', 'indexeddb', 'persist', 'save', 'store', 'setitem', 'getitem'],
    api: ['api', 'fetch', 'axios', 'request', 'endpoint', 'route', 'controller'],
    state: ['state', 'context', 'createcontext', 'reducer', 'dispatch', 'usestate', 'provider', 'store'],
    component: ['component', 'react', 'jsx', 'tsx', 'render', 'ui', 'view'],
    test: ['test', 'testing', 'jest', 'vitest', 'spec', 'describe', 'it('],
    config: ['config', 'configuration', 'env', 'settings', 'constants'],
    hook: ['hook', 'useeffect', 'usestate', 'usecallback', 'customhook'],
    route: ['route', 'router', 'routing', 'path', 'navigate', 'navigation'],
    error: ['error', 'exception', 'catch', 'try', 'handler', 'logging', 'logger'],
  };

  for (const term of terms) {
    const clean = term.replace(/[^a-z0-9]/g, '');
    if (!clean) continue;
    for (const [key, values] of Object.entries(synonyms)) {
      if (clean.includes(key) || key.includes(clean)) {
        values.forEach((v) => expansions.add(v));
      }
    }
  }

  // Always include a generic code signal to align query vectors with code files.
  expansions.add('code implementation function file');

  const expansionText = expansions.size > 0 ? ` ${Array.from(expansions).join(' ')}` : '';
  return `${query.trim()}${expansionText}`.slice(0, 5000);
}

/**
 * Race a promise against a timeout. Rejects with a clear error if the promise
 * does not resolve within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Try to embed a single file, retrying on timeout/failure up to `maxRetries`
 * times with exponential backoff. This helps when the browser is under load
 * or when the ONNX runtime temporarily stalls.
 */
async function embedFileWithRetry(
  embedder: FeatureExtractionPipeline,
  path: string,
  content: string,
  maxRetries = 3,
  baseTimeoutMs = 8000,
  onAttempt?: (attempt: number) => void
): Promise<FileEmbedding> {
  const input = buildEmbeddingInput(path, content);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    onAttempt?.(attempt);
    try {
      const timeoutMs = baseTimeoutMs * (attempt + 1);
      const output = await withTimeout(
        embedder(input, { pooling: 'mean', normalize: true }),
        timeoutMs,
        `Embedding ${path} (attempt ${attempt + 1}/${maxRetries + 1})`
      );

      const data = output.data as number[] | Float32Array;
      const embedding = Array.isArray(data) ? data : Array.from(data);

      if (embedding.length !== 384) {
        console.warn(`Unexpected embedding length for ${path}: ${embedding.length}`);
      }

      return { path, embedding };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Embedding retry ${attempt + 1}/${maxRetries + 1} failed for ${path}:`, lastError.message);
      if (attempt < maxRetries) {
        // Exponential backoff: 250ms, 500ms, 1000ms, ...
        const delay = 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error(`Failed to embed ${path} after ${maxRetries + 1} attempts`);
}

/**
 * Generate 384-dimensional embeddings for an array of ProjectFile objects.
 *
 * @param files - Array of { path, content } objects.
 * @param onProgress - Optional callback invoked after each file is embedded.
 *   Called with the current index, total, path, and optional retry attempt.
 * @returns Array of { path, embedding } objects in the same order as the input.
 */
export async function generateEmbeddings(
  files: ProjectFile[],
  onProgress?: (index: number, total: number, path: string, attempt?: number) => void
): Promise<FileEmbedding[]> {
  if (files.length === 0) return [];

  const embedder = await getEmbeddingPipeline();
  const results: FileEmbedding[] = [];

  for (let i = 0; i < files.length; i++) {
    const { path, content } = files[i];

    const result = await embedFileWithRetry(
      embedder,
      path,
      content,
      3,
      8000,
      (attempt) => onProgress?.(i + 1, files.length, path, attempt)
    );
    results.push(result);
  }

  return results;
}

/**
 * Generate a normalized 384-dimensional embedding vector for an arbitrary
 * natural-language query string.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const embedder = await getEmbeddingPipeline();
  const output = await embedder(expandQuery(query), {
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
 *   Default 0.20 is more forgiving for the small all-MiniLM-L6-v2 model so
 *   borderline-but-relevant code files still appear.
 */
export function findTopMatches(
  queryEmbedding: number[],
  fileEmbeddings: FileEmbedding[],
  topK = 5,
  minScore = 0.2
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
 * A lightweight keyword fallback for cases where the embedding model does not
 * produce confident matches. It scores files by how many query words appear in
 * their path or content, then normalizes to a 0–1 range.
 */
export function keywordSearch(
  query: string,
  files: ProjectFile[],
  topK = 5
): Array<{ path: string; score: number; index: number }> {
  const rawTerms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .map((t) => t.replace(/(ing|ed|s)$/, ''));

  const terms = Array.from(new Set(rawTerms));
  if (terms.length === 0) return [];

  const scored = files.map((file, index) => {
    const haystack = `${file.path} ${file.content}`.toLowerCase();
    let matches = 0;
    let pathMatches = 0;
    for (const term of terms) {
      const count = (haystack.match(new RegExp(term, 'g')) || []).length;
      matches += count;
      if (file.path.toLowerCase().includes(term)) pathMatches += 1;
    }
    // Weight path matches heavily because filenames are strong signals.
    const score = Math.min(1, matches * 0.05 + pathMatches * 0.25);
    return { path: file.path, score, index };
  });

  scored.sort((x, y) => y.score - x.score);
  return scored.filter((m) => m.score > 0).slice(0, topK);
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
