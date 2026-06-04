import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const OBFUSCATE_FILES = new Set([
  'background/service-worker.js',
  'content/content-bridge.js',
  'content/content-inject.js',
  'devtools/devtools.js',
  'devtools-panel/panel.js',
  'options/options.js',
  'shared/constants.js',
  'shared/storage.js',
]);
const COPY_DIRS = [
  {
    src: path.join(srcDir, 'options', 'vendor'),
    dest: path.join(distDir, 'options', 'vendor'),
  },
];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(srcDirPath, destDirPath) {
  const entries = await fs.readdir(srcDirPath, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDirPath, entry.name);
    const destPath = path.join(destDirPath, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function transformJs(filePath, relPath) {
  const input = await fs.readFile(filePath, 'utf8');
  const minified = await minify(input, {
    compress: true,
    mangle: true,
    format: { comments: false },
  });

  if (!minified.code) {
    throw new Error(`Failed to minify ${relPath}`);
  }

  if (!OBFUSCATE_FILES.has(relPath)) {
    return minified.code;
  }

  const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'mangled',
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,
    stringArrayThreshold: 0.75,
  });

  return obfuscated.getObfuscatedCode();
}

async function walkAndBuild(currentDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(currentDir, entry.name);
    const relPath = path.relative(srcDir, srcPath).replace(/\\/g, '/');
    const destPath = path.join(distDir, relPath);

    if (entry.isDirectory()) {
      await walkAndBuild(srcPath);
      continue;
    }

    if (path.basename(srcPath) === 'manifest.json') {
      await copyFile(srcPath, destPath);
      continue;
    }

    if (JS_EXTENSIONS.has(path.extname(srcPath))) {
      const code = await transformJs(srcPath, relPath);
      await ensureDir(path.dirname(destPath));
      await fs.writeFile(destPath, code, 'utf8');
      continue;
    }

    await copyFile(srcPath, destPath);
  }
}

async function build() {
  await fs.rm(distDir, { recursive: true, force: true });
  await ensureDir(distDir);
  await walkAndBuild(srcDir);
  for (const dir of COPY_DIRS) {
    if (await fs.stat(dir.src).catch(() => null)) {
      await copyDir(dir.src, dir.dest);
    }
  }
  console.log(`Build complete: ${distDir}`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
