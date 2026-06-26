# SourceSphere

A lightweight, privacy-first tool to explore any codebase with AI-powered semantic search and a 3D visualization in the browser.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Why SourceSphere?

- **Drop a folder, find answers** — no manual grep required.
- **Privacy-first** — code stays on your machine; no upload server.
- **Works everywhere** — browser UI + cross-platform CLI.
- **Pluggable AI** — local embeddings by default, or bring your own OpenAI-compatible API.

## Quick Start

### Web UI

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), drop a project folder, and start searching.

### CLI

```bash
# Interactive mode — answer the prompts, then ask as many questions as you want
npx tsx src/cli/index.ts

# One-shot mode for scripts
npx tsx src/cli/index.ts ./my-project -q "where is auth handled?"

# Skip embedding next time: load previously saved embeddings and keep asking
npx tsx src/cli/index.ts --load sourcesphere-embeddings.json
```

When you run the CLI without a query, it will prompt: *"What would you like to ask about your code?"* — type a question to search, or type **exit** to quit. You can ask as many follow-up questions as you want without re-embedding. Embeddings are auto-saved to `sourcesphere-embeddings.json` by default, so you can resume later with `--load`.

## Features

- Drag & drop folder upload with `webkitdirectory`
- Recursive parsing of code files (`.js`, `.ts`, `.py`, `.java`, `.cpp`, and more)
- Natural-language semantic search with similarity scores
- PCA-based 3D code graph (web UI)
- Swappable embedding providers:
  - **Xenova** (local, free, runs in browser & Node)
  - **OpenAI-compatible** APIs

## Tech Stack

Next.js · React · TypeScript · Tailwind CSS · Three.js · Transformers.js · Commander · Inquirer

## CLI Options

```
npx tsx src/cli/index.ts [folder] [options]
  -i, --interactive      Run interactive setup prompts
  -q, --query <text>     Search query
  -o, --output <file>    Save embeddings JSON (default: sourcesphere-embeddings.json)
  -l, --load <file>      Load embeddings JSON and skip parsing/embedding
  --provider <xenova|openai>
  --api-key, --base-url, --model, --env-file
```

## Environment Variables

```bash
SOURCESPHERE_PROVIDER=openai
SOURCESPHERE_API_KEY=sk-...
SOURCESPHERE_BASE_URL=https://api.openai.com/v1
SOURCESPHERE_MODEL=text-embedding-3-small
SOURCESPHERE_QUANTIZED=true
```
