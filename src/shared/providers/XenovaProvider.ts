import {
  pipeline,
  FeatureExtractionPipeline,
} from '@xenova/transformers';
import {
  EmbeddingProvider,
  FileEmbedding,
} from './EmbeddingProvider';
import { ProjectFile } from '../fileParser';

export interface XenovaProviderOptions {
  /** Hugging Face model id compatible with Transformers.js. */
  model?: string;
  /** Whether to use a quantized (smaller) model. */
  quantized?: boolean;
  /** Per-file embedding timeout in milliseconds. */
  timeoutMs?: number;
  /** Number of retries on timeout/failure. */
  maxRetries?: number;
}

/**
 * Local embedding provider using Transformers.js.
 * Works in the browser and in Node.js.
 */
export class XenovaProvider implements EmbeddingProvider {
  readonly name = 'Xenova/Transformers.js';

  private model: string;
  private quantized: boolean;
  private timeoutMs: number;
  private maxRetries: number;
  private pipeline: FeatureExtractionPipeline | null = null;

  constructor(options: XenovaProviderOptions = {}) {
    this.model = options.model ?? 'Xenova/all-MiniLM-L6-v2';
    this.quantized = options.quantized ?? false;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipeline) {
      this.pipeline = await pipeline('feature-extraction', this.model, {
        quantized: this.quantized,
      });
    }
    return this.pipeline;
  }

  async embedFiles(
    files: ProjectFile[],
    onProgress?: (index: number, total: number, path: string, attempt?: number) => void
  ): Promise<FileEmbedding[]> {
    if (files.length === 0) return [];
    const embedder = await this.getPipeline();
    const results: FileEmbedding[] = [];

    for (let i = 0; i < files.length; i++) {
      const { path, content } = files[i];
      const embedding = await this.embedWithRetry(
        embedder,
        this.buildInput(path, content),
        path,
        (attempt) => onProgress?.(i + 1, files.length, path, attempt)
      );
      results.push({ path, embedding });
    }

    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    const embedder = await this.getPipeline();
    const output = await embedder(query.trim().slice(0, 5000), {
      pooling: 'mean',
      normalize: true,
    });
    const data = output.data as number[] | Float32Array;
    return Array.isArray(data) ? data : Array.from(data);
  }

  private buildInput(path: string, content: string): string {
    return `File: ${path}\n\n${content.trim().slice(0, 5000)}`;
  }

  private async embedWithRetry(
    embedder: FeatureExtractionPipeline,
    input: string,
    path: string,
    onAttempt?: (attempt: number) => void
  ): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      onAttempt?.(attempt);
      try {
        const timeoutMs = this.timeoutMs * (attempt + 1);
        const output = await Promise.race([
          embedder(input, { pooling: 'mean', normalize: true }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Embedding ${path} timed out after ${timeoutMs}ms`)),
              timeoutMs
            )
          ),
        ]);

        const data = output.data as number[] | Float32Array;
        const embedding = Array.isArray(data) ? data : Array.from(data);
        return embedding;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `Embedding attempt ${attempt + 1}/${this.maxRetries + 1} failed for ${path}:`,
          lastError.message
        );
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
    }

    throw lastError ?? new Error(`Failed to embed ${path} after ${this.maxRetries + 1} attempts`);
  }
}
