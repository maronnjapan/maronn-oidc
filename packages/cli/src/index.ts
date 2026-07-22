#!/usr/bin/env node

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { generate, getAvailableFrameworks } from './generator.js';
import { AVAILABLE_FEATURES, resolveFeatures } from './features.js';

const INSTALL_COMMANDS: Record<string, string> = {
  hono: 'pnpm add hono @maronn-oidc/core',
  express: 'pnpm add express @maronn-oidc/core && pnpm add -D @types/express',
  fastify: 'pnpm add fastify @maronn-oidc/core',
  nextjs: 'pnpm add @maronn-oidc/core && pnpm add -D next react react-dom',
};

const SETUP_UNSUPPORTED_FRAMEWORKS = new Set(['nextjs']);

function printUsage(): void {
  const frameworks = getAvailableFrameworks().join(', ');
  const features = AVAILABLE_FEATURES.join(', ');
  console.log(`
Usage: maronn-oidc <command> <framework> [options]

Commands:
  generate <framework>  Generate OIDC provider code for the specified framework
  setup <framework>     Generate OIDC provider code and apply it to an existing entry file

Frameworks: ${frameworks}

Options:
  --output, -o <dir>    Output directory (default: ./oidc-provider)
  --entry, -e <file>    Entry file to patch with OIDC setup (setup command only, default: ./src/index.ts)
  --enable <features>   Comma-separated features to enable (repeatable)
  --disable <features>  Comma-separated features to remove from the default set (repeatable)
  --help, -h            Show this help message

Features (all enabled by default): ${features}
`);
}

function parseArgs(args: string[]): {
  command?: string;
  framework?: string;
  outputDir: string;
  entryFile: string;
  enable: string[];
  disable: string[];
  help: boolean;
} {
  let command: string | undefined;
  let framework: string | undefined;
  let outputDir = './oidc-provider';
  let entryFile = './src/index.ts';
  const enable: string[] = [];
  const disable: string[] = [];
  let help = false;

  const splitFeatureList = (value: string | undefined): string[] =>
    (value ?? '').split(',').map((f) => f.trim()).filter((f) => f.length > 0);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--output' || arg === '-o') {
      i++;
      outputDir = args[i] ?? outputDir;
    } else if (arg === '--entry' || arg === '-e') {
      i++;
      entryFile = args[i] ?? entryFile;
    } else if (arg === '--enable') {
      i++;
      enable.push(...splitFeatureList(args[i]));
    } else if (arg === '--disable') {
      i++;
      disable.push(...splitFeatureList(args[i]));
    } else if (!command) {
      command = arg;
    } else if (!framework) {
      framework = arg;
    }
  }

  return { command, framework, outputDir, entryFile, enable, disable, help };
}

function writeGeneratedFiles(outputDir: string, files: Array<{ path: string; content: string }>): void {
  for (const file of files) {
    const fullPath = join(outputDir, file.path);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, file.content, 'utf-8');
    console.log(`  Created: ${file.path}`);
  }
}

function patchEntryFile(entryFilePath: string, outputDir: string): void {
  const entryDir = dirname(resolve(entryFilePath));
  const resolvedOutput = resolve(outputDir);
  const relPath = relative(entryDir, resolvedOutput);
  const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`;
  const applyImportPath = `${importPath}/apply.js`;

  let content = readFileSync(entryFilePath, 'utf-8');
  content = content.replace(
    '// <!-- OIDC_IMPORT_PLACEHOLDER -->',
    `import { applyOidc } from '${applyImportPath}';`,
  );
  content = content.replace(
    '// <!-- OIDC_SETUP_PLACEHOLDER -->',
    'applyOidc(app);',
  );
  writeFileSync(entryFilePath, content, 'utf-8');
  console.log(`  Patched: ${entryFilePath}`);
}

export function run(args: string[]): void {
  const parsed = parseArgs(args);

  if (parsed.help || !parsed.command) {
    printUsage();
    return;
  }

  if (parsed.command !== 'generate' && parsed.command !== 'setup') {
    console.error(`Unknown command: ${parsed.command}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!parsed.framework) {
    console.error('Error: Framework name is required.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (parsed.command === 'setup' && SETUP_UNSUPPORTED_FRAMEWORKS.has(parsed.framework)) {
    console.error(
      'Error: setup is not supported for Next.js. Use: maronn-oidc generate nextjs --output ./src/app',
    );
    process.exitCode = 1;
    return;
  }

  if (parsed.command === 'setup' && !existsSync(parsed.entryFile)) {
    console.error(`Error: Entry file not found: ${parsed.entryFile}`);
    process.exitCode = 1;
    return;
  }

  try {
    const features = resolveFeatures({
      enable: parsed.enable,
      disable: parsed.disable,
    });
    const result = generate({
      framework: parsed.framework,
      outputDir: parsed.outputDir,
      features,
    });

    console.log(`\nGenerating ${result.framework} OIDC Provider code...\n`);
    const disabledFeatures = AVAILABLE_FEATURES.filter(
      (name) => parsed.disable.includes(name),
    );
    if (disabledFeatures.length > 0) {
      console.log(`Disabled features: ${disabledFeatures.join(', ')}\n`);
    }
    writeGeneratedFiles(parsed.outputDir, result.files);
    console.log(`\nDone! Generated ${result.files.length} files in ${parsed.outputDir}`);

    if (parsed.command === 'setup') {
      console.log(`\nPatching entry file...`);
      patchEntryFile(parsed.entryFile, parsed.outputDir);
      console.log(`\nNext steps:`);
      console.log(`  1. Provide runtime config, signing keys, and client resolvers from env/DB/KV`);
      console.log(`  2. Use ${parsed.outputDir}/config.ts defaults only for quick local testing`);
      console.log(`  3. Start the server\n`);
    } else {
      const installCommand =
        INSTALL_COMMANDS[result.framework] ?? `pnpm add @maronn-oidc/core`;
      console.log(`\nNext steps:`);
      console.log(`  1. Provide runtime config, signing keys, and client resolvers from env/DB/KV`);
      console.log(`  2. Use config.ts defaults only for quick local testing`);
      console.log(`  3. Install dependencies: ${installCommand}`);
      console.log(`  4. Start the server\n`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

// Run CLI when executed directly
const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0 || process.argv[1]?.includes('maronn-oidc')) {
  run(cliArgs);
}
