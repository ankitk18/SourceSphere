#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { input, select, confirm, password, number } from '@inquirer/prompts';
import { parseDirectory } from '../shared/nodeFileParser';
import { expandQuery, findTopMatches, keywordSearch } from '../shared/search';
import { ProjectFile } from '../shared/fileParser';
import { FileEmbedding } from '../shared/providers/EmbeddingProvider';
import { XenovaProvider } from '../shared/providers/XenovaProvider';
import { OpenAICompatibleProvider } from '../shared/providers/OpenAICompatibleProvider';
import { EmbeddingProvider } from '../shared/providers/EmbeddingProvider';

interface CliOptions {
  folder?: string;
  query?: string;
  output?: string;
  load?: string;
  limit: number;
  provider: 'xenova' | 'openai';
  apiKey?: string;
  baseURL?: string;
  model?: string;
  envFile?: string;
  interactive?: boolean;
}

const DEFAULT_EMBEDDINGS_FILE = 'sourcesphere-embeddings.json';

function createProvider(options: CliOptions): EmbeddingProvider {
  if (options.provider === 'openai') {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.SOURCESPHERE_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OpenAI provider selected but no API key found. Pass --api-key or set OPENAI_API_KEY / SOURCESPHERE_API_KEY.'
      );
    }
    return new OpenAICompatibleProvider({
      apiKey,
      baseURL: options.baseURL ?? process.env.SOURCESPHERE_BASE_URL,
      model: options.model ?? process.env.SOURCESPHERE_MODEL,
    });
  }

  return new XenovaProvider({
    model: process.env.SOURCESPHERE_MODEL,
    quantized: process.env.SOURCESPHERE_QUANTIZED === 'true',
  });
}

async function collectInteractiveOptions(): Promise<CliOptions> {
  console.log('👋 Welcome to SourceSphere CLI\n');

  const folder = await input({
    message: 'Project folder path:',
    default: '.',
    validate: (value) => value.trim().length > 0 || 'Please enter a folder path.',
  });

  const provider = await select<'xenova' | 'openai'>({
    message: 'Embedding provider:',
    choices: [
      { name: 'Xenova (local, no API key)', value: 'xenova' },
      { name: 'OpenAI-compatible API', value: 'openai' },
    ],
    default: 'xenova',
  });

  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let model: string | undefined;

  if (provider === 'openai') {
    const envKey = process.env.OPENAI_API_KEY ?? process.env.SOURCESPHERE_API_KEY;
    if (!envKey) {
      apiKey = await password({
        message: 'API key:',
        mask: '*',
        validate: (value) => value.trim().length > 0 || 'API key is required.',
      });
    } else {
      const useEnvKey = await confirm({
        message: 'Use API key from environment?',
        default: true,
      });
      apiKey = useEnvKey ? envKey : await password({ message: 'API key:', mask: '*' });
    }

    baseURL =
      (await input({
        message: 'Base URL (leave blank for default OpenAI):',
      })) || undefined;

    model =
      (await input({
        message: 'Model (leave blank for provider default):',
      })) || undefined;
  } else {
    const useCustomModel = await confirm({
      message: 'Use a custom Xenova model?',
      default: false,
    });
    if (useCustomModel) {
      model = await input({ message: 'Model name (e.g. Xenova/all-MiniLM-L6-v2):' });
    }
  }

  const query =
    (await input({
      message: 'Natural-language query (optional):',
    })) || undefined;

  const output = await input({
    message: 'Embeddings output file:',
    default: DEFAULT_EMBEDDINGS_FILE,
  });

  const limit = await number({
    message: 'Number of top search results:',
    default: 5,
  });

  return {
    folder,
    provider,
    apiKey,
    baseURL,
    model,
    query,
    output,
    limit: limit ?? 5,
  } as CliOptions;
}

async function performSearch(
  options: CliOptions,
  files: ProjectFile[],
  embeddings: FileEmbedding[],
  provider: EmbeddingProvider
): Promise<boolean> {
  if (!options.query) return false;

  console.log(`\nSearching: "${options.query}"…`);
  const expandedQuery = expandQuery(options.query);
  const queryEmbedding = await provider.embedQuery(expandedQuery);

  let matches = findTopMatches(queryEmbedding, embeddings, options.limit);
  if (matches.length === 0) {
    console.log('No confident embedding matches; falling back to keyword search.');
    matches = keywordSearch(options.query, files, options.limit).map((m) => ({
      path: m.path,
      embedding: embeddings[m.index].embedding,
      score: m.score,
      index: m.index,
    }));
  }

  if (matches.length === 0) {
    console.log('No matches found.');
    return true;
  }

  console.log(`\nTop ${matches.length} matches:\n`);
  matches.forEach((m, i) => {
    const pct = (m.score * 100).toFixed(1);
    console.log(`${i + 1}. ${m.path} (${pct}%)`);
  });

  return true;
}

async function run(options: CliOptions) {
  // Optionally load a custom env file.
  if (options.envFile) {
    const { config } = await import('dotenv');
    config({ path: options.envFile });
  }

  let files: ProjectFile[] = [];
  let embeddings: FileEmbedding[] = [];

  if (options.load) {
    const loadPath = path.resolve(options.load);
    console.log(`\nLoading embeddings from ${loadPath}…`);
    const raw = await fs.readFile(loadPath, 'utf-8');
    embeddings = JSON.parse(raw) as FileEmbedding[];
    console.log(`Loaded ${embeddings.length} embeddings.`);
  } else {
    const resolvedFolder = path.resolve(options.folder ?? '.');
    console.log(`\nParsing ${resolvedFolder}…`);
    files = await parseDirectory(resolvedFolder);
    console.log(`Found ${files.length} readable code files.`);

    if (files.length === 0) {
      console.log('No files to embed. Exiting.');
      return;
    }

    const provider = createProvider(options);
    console.log(`Using embedding provider: ${provider.name}`);

    const startTime = Date.now();
    embeddings = await provider.embedFiles(files, (current, total, filePath) => {
      if (current === 1 || current % 5 === 0 || current === total) {
        process.stdout.write(`\rEmbedding ${current}/${total}: ${filePath.slice(0, 60)}`);
      }
    });
    process.stdout.write('\n');
    console.log(`Embeddings generated in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

    const outputPath = options.output ?? DEFAULT_EMBEDDINGS_FILE;
    await fs.writeFile(outputPath, JSON.stringify(embeddings, null, 2));
    console.log(`Saved embeddings to ${outputPath}`);
  }

  console.log('\nEmbeddings ready. Ask questions about your code, or type "exit" to quit.');

  const provider = createProvider(options);
  let currentOptions = { ...options };

  while (true) {
    const prompt = currentOptions.query
      ? 'Ask another question (or "exit" to quit):'
      : 'What would you like to ask about your code? (or "exit" to quit)';

    const userInput = await input({
      message: prompt,
    });
    const query = userInput.trim();

    if (query.toLowerCase() === 'exit') {
      const loadHint = options.load
        ? options.load
        : (options.output ?? DEFAULT_EMBEDDINGS_FILE);
      console.log(`Done. To resume asking questions later, run:`);
      console.log(`  npx tsx src/cli/index.ts --load ${loadHint}`);
      break;
    }

    if (!query) {
      console.log('Waiting for a question. Type "exit" to quit.');
      continue;
    }

    currentOptions = { ...currentOptions, query };
    await performSearch(currentOptions, files, embeddings, provider);
  }
}

async function main() {
  const program = new Command();
  program
    .name('sourcesphere')
    .description('Parse a project folder, generate embeddings, and search with natural language.')
    .version('0.1.0')
    .argument('[folder]', 'Path to the project folder to analyze')
    .option('-q, --query <text>', 'Natural-language query to search the codebase')
    .option('-o, --output <file>', 'Write embeddings JSON to this file', DEFAULT_EMBEDDINGS_FILE)
    .option('-l, --load <file>', 'Load embeddings JSON and skip parsing/embedding')
    .option('-n, --limit <number>', 'Number of top search results to show', '5')
    .option('--provider <xenova|openai>', 'Embedding provider', 'xenova')
    .option('--api-key <key>', 'API key for OpenAI-compatible provider')
    .option('--base-url <url>', 'Base URL for OpenAI-compatible provider')
    .option('--model <name>', 'Embedding model name')
    .option('--env-file <path>', 'Path to a .env file to load')
    .option('-i, --interactive', 'Run interactive setup prompts')
    .parse();

  const options = program.opts() as CliOptions;
  options.limit = parseInt(options.limit as unknown as string, 10);

  // If no folder was passed and --interactive wasn't explicitly set, default to interactive.
  const wantsInteractive = options.interactive || (program.args.length === 0 && !options.load);

  if (wantsInteractive) {
    const interactiveOptions = await collectInteractiveOptions();
    // Merge any flags that were provided with interactive answers (flags win).
    await run({ ...interactiveOptions, ...options, folder: options.folder ?? interactiveOptions.folder });
    return;
  }

  if (options.load && program.args.length > 0) {
    console.warn('Warning: --load is set; folder argument will be ignored.');
  }

  const folder = program.args[0];
  if (!folder && !options.load) {
    console.error('Please provide a folder path, or run with --interactive / --load.');
    process.exit(1);
  }
  options.folder = folder;

  await run(options);
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  process.exit(1);
});
