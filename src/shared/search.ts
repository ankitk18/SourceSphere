import { FileEmbedding } from './providers/EmbeddingProvider';
import { ProjectFile } from './fileParser';

/**
 * Compute cosine similarity between two vectors.
 * Works for any dimensionality, so it can handle both 384-dim Xenova vectors
 * and OpenAI 1536-dim vectors.
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
 * Lightweight keyword fallback for cases where the embedding model does not
 * produce confident matches.
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
    const score = Math.min(1, matches * 0.05 + pathMatches * 0.25);
    return { path: file.path, score, index };
  });

  scored.sort((x, y) => y.score - x.score);
  return scored.filter((m) => m.score > 0).slice(0, topK);
}

/**
 * Expand a natural-language query with code-related synonyms before embedding.
 */
export function expandQuery(query: string): string {
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

  expansions.add('code implementation function file');

  const expansionText = expansions.size > 0 ? ` ${Array.from(expansions).join(' ')}` : '';
  return `${query.trim()}${expansionText}`.slice(0, 5000);
}
