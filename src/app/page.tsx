'use client';

import { useMemo, useRef, useState } from 'react';
import FileDropzone from '@/components/FileDropzone';
import { ProjectFile } from '@/utils/fileParser';
import {
  FileEmbedding,
  findTopMatches,
  generateEmbeddings,
  generateQueryEmbedding,
  keywordSearch,
} from '@/utils/embeddings';
import CodeForceGraph, { GraphNode } from '@/components/ForceGraph3D';

function GraphSection({
  coordinates,
  files,
  highlightedIndex,
}: {
  coordinates: { x: number; y: number; z: number }[];
  files: ProjectFile[];
  highlightedIndex: number | null;
}) {
  const nodes = useMemo(
    () =>
      coordinates.map(
        (point, i): GraphNode => {
          const path = files[i]?.path ?? `node-${i}`;
          return {
            id: `${i}::${path}`,
            path,
            x: point.x,
            y: point.y,
            z: point.z,
          };
        }
      ),
    [coordinates, files]
  );

  return (
    <div className="mb-6">
      <CodeForceGraph nodes={nodes} highlightedIndex={highlightedIndex} />
    </div>
  );
}

export default function Home() {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [embeddings, setEmbeddings] = useState<FileEmbedding[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState<{ current: number; total: number; path: string } | null>(null);
  const [coordinates3D, setCoordinates3D] = useState<{ x: number; y: number; z: number }[]>([]);
  const [showGraph, setShowGraph] = useState(false);

  // Natural-language search state.
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ path: string; score: number; index: number }> | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  // Refs for each file card so search results can scroll to them.
  const fileCardRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  const handleDrop = async (projectFiles: ProjectFile[]) => {
    setIsLoading(true);
    setEmbeddings([]);
    setEmbedProgress(null);
    try {
      // Small artificial delay so the loader is perceptible on tiny folders.
      await new Promise((resolve) => setTimeout(resolve, 300));
      setFiles(projectFiles);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateEmbeddings = async () => {
    if (files.length === 0) return;
    setIsEmbedding(true);
    setEmbedProgress({ current: 0, total: files.length, path: '' });
    try {
      const generated = await generateEmbeddings(files, (current, total, path, attempt) => {
        const label = attempt && attempt > 0 ? `${path} (retry ${attempt})` : path;
        setEmbedProgress({ current, total, path: label });
      });
      setEmbeddings(generated);
    } catch (err) {
      console.error('Embedding generation failed:', err);
      alert('Embedding generation failed. The browser may be under load or the model download was interrupted. Try again with fewer files or reload the page.');
    } finally {
      setIsEmbedding(false);
      setEmbedProgress(null);
    }
  };

  const handleClear = () => {
    setFiles([]);
    setEmbeddings([]);
    setCoordinates3D([]);
    setShowGraph(false);
    setEmbedProgress(null);
    setSearchResults(null);
    setHighlightedIndex(null);
  };

  const handleReduceTo3D = async () => {
    if (embeddings.length === 0) return;

    try {
      // Dynamic import keeps the PCA code out of the initial bundle until needed.
      const { pcaReduceTo3D } = await import('@/utils/dimensionality');
      const vectors = embeddings.map((e) => e.embedding);
      const { points, eigenvalues, explainedVariance } = pcaReduceTo3D(vectors);
      console.log('PCA result:', {
        pointCount: points.length,
        samplePoint: points[0],
        eigenvalues,
        explainedVariance,
      });
      setCoordinates3D(points);
      setShowGraph(true);
    } catch (err) {
      console.error('3D reduction failed:', err);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || embeddings.length === 0) return;

    setIsSearching(true);
    setSearchResults(null);
    setHighlightedIndex(null);
    try {
      const trimmedQuery = query.trim();
      const queryEmbedding = await generateQueryEmbedding(trimmedQuery);
      const matches = findTopMatches(queryEmbedding, embeddings, 5);

      // If the embedding model returns no confident matches, fall back to
      // a simple keyword search so the user still sees relevant files.
      const results =
        matches.length > 0
          ? matches.map((m) => ({
              path: m.path,
              score: m.score,
              index: m.index,
            }))
          : keywordSearch(trimmedQuery, files, 5).map((m) => ({
              path: m.path,
              score: m.score,
              index: m.index,
            }));

      setSearchResults(results);
      if (results.length > 0) {
        setHighlightedIndex(results[0].index);
        setShowGraph(true);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const scrollToFile = (path: string) => {
    const el = fileCardRefs.current.get(path);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-10 text-center">
        <h1 className="mb-3 text-4xl font-bold tracking-tight text-white">
          Project Folder Uploader
        </h1>
        <p className="text-lg text-slate-400">
          Drag-and-drop or browse an entire folder. We’ll recursively read every code file inside.
        </p>
      </div>

      <FileDropzone onDrop={handleDrop} isLoading={isLoading} />

      {files.length > 0 && !isLoading && (
        <section className="mt-12">
          <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">How to use</h3>
            <ol className="list-inside list-decimal space-y-1 text-sm text-slate-300">
              <li>Generate embeddings to vectorize every file.</li>
              <li>Click Reduce to 3D to compute the 3D layout.</li>
              <li>Ask a question in the search box, e.g. “Where is workout data stored?”</li>
              <li>Click any matched file to jump straight to it in the list below.</li>
            </ol>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">
              Parsed Files <span className="ml-2 text-sm font-normal text-slate-400">({files.length})</span>
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerateEmbeddings}
                disabled={isEmbedding}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isEmbedding ? 'Embedding…' : 'Generate Embeddings'}
              </button>
              <button
                onClick={handleReduceTo3D}
                disabled={embeddings.length === 0}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reduce to 3D
              </button>
              <button
                onClick={() => setShowGraph((s) => !s)}
                disabled={coordinates3D.length === 0}
                className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {showGraph ? 'Hide Graph' : 'Show Graph'}
              </button>
              <button
                onClick={handleClear}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>

          {isEmbedding && embedProgress && (
            <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-300">Embedding files…</span>
                <span className="text-slate-400">
                  {embedProgress.current}/{embedProgress.total}
                </span>
              </div>
              <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-indigo-500 transition-all duration-200"
                  style={{
                    width: `${(embedProgress.current / embedProgress.total) * 100}%`,
                  }}
                />
              </div>
              <p className="truncate text-xs text-slate-500">{embedProgress.path || 'Initializing model…'}</p>
            </div>
          )}

          {embeddings.length > 0 && !isEmbedding && (
            <div className="mb-6 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
              <p className="text-sm text-emerald-300">
                Generated {embeddings.length} embedding{embeddings.length === 1 ? '' : 's'} of{' '}
                {embeddings[0]?.embedding.length} dimensions each.
              </p>
            </div>
          )}

          {embeddings.length > 0 && (
            <form onSubmit={handleSearch} className="mb-6 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about your code, e.g. Where is the database connection handled?"
                disabled={isSearching}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSearching ? 'Searching…' : 'Find Best Match'}
              </button>
            </form>
          )}

          {searchResults !== null && searchResults.length === 0 && (
            <div className="mb-6 rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
              <p className="text-sm text-rose-300">
                No matches found. Try rephrasing your query or uploading more
                files.
              </p>
            </div>
          )}

          {searchResults !== null && searchResults.length > 0 && (
            <div className="mb-6 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
              <p className="mb-2 text-sm font-semibold text-amber-300">Top matches (click to jump to file)</p>
              <ol className="space-y-1.5">
                {searchResults.map((result) => (
                  <li key={result.index} className="flex items-center gap-2 text-sm text-amber-200">
                    <button
                      type="button"
                      onClick={() => {
                        setHighlightedIndex(result.index);
                        scrollToFile(result.path);
                      }}
                      className="font-mono text-left underline decoration-amber-500/60 underline-offset-2 transition hover:text-amber-100"
                    >
                      {result.path}
                    </button>
                    <span className="ml-auto shrink-0 text-xs text-amber-400/80">
                      {(result.score * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {coordinates3D.length === 0 && embeddings.length > 0 && !isEmbedding && (
            <div className="mb-6 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4">
              <p className="text-sm text-amber-300">
                No 3D coordinates yet. Click "Reduce to 3D" to compute them.
              </p>
            </div>
          )}

          {showGraph && coordinates3D.length > 0 && (
            <GraphSection
              coordinates={coordinates3D}
              files={files}
              highlightedIndex={highlightedIndex}
            />
          )}

          {coordinates3D.length > 0 && !showGraph && (
            <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="mb-3 text-sm font-semibold text-white">Normalized 3D Coordinates ({coordinates3D.length} points)</h3>
              <div className="grid max-h-64 gap-2 overflow-auto text-xs">
                {coordinates3D.map((point, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg bg-slate-950/50 px-3 py-2">
                    <span className="w-8 shrink-0 font-mono text-slate-500">#{i + 1}</span>
                    <span className="truncate font-mono text-indigo-400">{files[i]?.path || 'unknown'}</span>
                    <span className="ml-auto font-mono text-slate-300">
                      X={point.x.toFixed(3)} Y={point.y.toFixed(3)} Z={point.z.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {files.map((file) => (
              <article
                key={file.path}
                ref={(el) => {
                  fileCardRefs.current.set(file.path, el);
                }}
                tabIndex={-1}
                className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <div className="border-b border-slate-800 bg-slate-950/50 px-4 py-3">
                  <p className="font-mono text-sm text-indigo-400">{file.path}</p>
                </div>
                <pre className="max-h-64 overflow-auto p-4 text-sm leading-relaxed text-slate-300">
                  <code>{file.content}</code>
                </pre>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
