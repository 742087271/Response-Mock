import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const outZip = path.join(rootDir, 'response-mock-extension.zip');

await fs.rm(outZip, { force: true });
execSync(`cd "${distDir}" && zip -r "${outZip}" .`, { stdio: 'inherit' });
console.log(`Pack complete: ${outZip}`);
