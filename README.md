# SourceSphere

SourceSphere is a Next.js application that lets you drag and drop an entire local project folder into the browser, reads every code file recursively, and then lets you explore the codebase through:

- **Natural-language search** — find files by asking plain questions like “Where is the database connection handled?”
- **3D semantic graph** — visualize files as nodes positioned by their embedding similarity using PCA.

Everything runs in the browser; no server-side code, no API keys, and no files are uploaded anywhere.

## Features

- Folder dropzone using the HTML5 `webkitdirectory` attribute
- Recursive reading of text files (`*.js`, `*.ts`, `*.jsx`, `*.tsx`, `*.py`, `*.java`, `*.cpp`, and many more)
- In-browser embeddings via `@xenova/transformers` and `all-MiniLM-L6-v2`
- Top-K semantic search with similarity scores
- PCA-based 3D layout rendered with `three.js`
- Click any search result to jump to its full source card
- Clean, modern dark UI built with Tailwind CSS

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload a project folder.

## How to Use

1. Click the dropzone or drag a project folder onto it.
2. Click **Generate Embeddings** to vectorize every file (this downloads the model once).
3. Click **Reduce to 3D** to compute the spatial layout.
4. Type a question in the search box, e.g. *“Where is workout data stored?”*
5. Click any matched file to scroll to its source or highlight it in the graph.

## Tech Stack

- [Next.js 14](https://nextjs.org/)
- [React 18](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Three.js](https://threejs.org/)
- [Transformers.js](https://huggingface.co/docs/transformers.js/)

## Scripts

| Script         | Description                  |
| -------------- | ---------------------------- |
| `npm run dev`  | Run the development server     |
| `npm run build`| Build for production           |
| `npm run start`| Start the production server    |
| `npm run lint` | Run ESLint                     |

## Notes

- The first embedding run downloads the ONNX model to the browser. It may take a moment depending on your connection.
- Very large folders (tens of thousands of files) may take a while to process; the parser filters out binary and common non-code files.

