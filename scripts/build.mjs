import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const template = readFileSync(resolve(root, 'worker/index.js'), 'utf8');
const marker = '"__ANIMAL_ZOO_HTML_PLACEHOLDER__"';
if (!template.includes(marker)) throw new Error('Missing HTML placeholder');
const build = resolve(root, 'dist');
mkdirSync(resolve(build, 'server'), { recursive: true });
mkdirSync(resolve(build, '.openai'), { recursive: true });
writeFileSync(resolve(build, 'server/index.js'), template.replace(marker, JSON.stringify(html)));
copyFileSync(resolve(root, '.openai/hosting.json'), resolve(build, '.openai/hosting.json'));
console.log('Built server/index.js and hosting manifest');
