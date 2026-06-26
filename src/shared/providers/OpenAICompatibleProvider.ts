import {
  EmbeddingProvider,
  FileEmbedding,
} from './EmbeddingProvider';
import { ProjectFile } from '../fileParser';

export interface OpenAICompatibleProviderOptions {
  /** API key for the provider. */
  apiKey: string;
  /** Base URL for the embeddings endpoint. Defaults to OpenAI. */
  baseURL?: string;
  /** Model name to request. */
  model?: string;
  /** Maximum requests per batch (files are sent in chunks). */
  batchSize?: number;
  /** Timeout for a single API call in milliseconds. */
  timeoutMs?: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * Embedding provider that calls any OpenAI-compatible `/embeddings` endpoint.
 * Works with OpenAI, Together, Ollama (when running OpenAI-compatible server),
 * local LLM servers, etc.
 */
export class OpenAICompatibleProvider implements EmbeddingProvider {
  readonly name = 'OpenAI-compatible API';

  private apiKey: string;
  private baseURL: string;
  private model: string;
  private batchSize: number;
  private timeoutMs: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OpenAICompatibleProvider requires an apiKey');
    }
    this.apiKey = options.apiKey;
    this.baseURL = (options.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = options.model ?? 'text-embedding-3-small';
    this.batchSize = options.batchSize ?? 32;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async embedFiles(
    files: ProjectFile[],
    onProgress?: (index: number, total: number, path: string) => void
  ): Promise<FileEmbedding[]> {
    if (files.length === 0) return [];

    const results: FileEmbedding[] = [];

    for (let i = 0; i < files.length; i += this.batchSize) {
      const batch = files.slice(i, i + this.batchSize);
      const inputs = batch.map((f) => this.buildInput(f.path, f.content));
      const response = await this.callEmbeddingsAPI(inputs);

      for (let j = 0; j < batch.length; j++) {
        const file = batch[j];
        const embedding = response.data.find((d) => d.index === j)?.embedding;
        if (!embedding) {
          throw new Error(`No embedding returned for ${file.path}`);
        }
        results.push({ path: file.path, embedding });
        onProgress?.(i + j + 1, files.length, file.path);
      }
    }

    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await this.callEmbeddingsAPI([query.trim().slice(0, 8000)]);
    if (!response.data[0]?.embedding) {
      throw new Error('No embedding returned for query');
    }
    return response.data[0].embedding;
  }

  private buildInput(path: string, content: string): string {
    return `File: ${path}\n\n${content.trim().slice(0, 5000)}`;
  }

  private async callEmbeddingsAPI(inputs: string[]): Promise<OpenAIEmbeddingResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: inputs,
          model: this.model,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${text}`);
      }

      return (await res.json()) as OpenAIEmbeddingResponse;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
