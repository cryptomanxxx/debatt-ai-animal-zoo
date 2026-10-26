import { build as bundle } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const renderer = await bundle({entryPoints:[resolve(root,'web/rufus/entry.js')],bundle:true,write:false,minify:true,format:'iife',target:'es2020',legalComments:'inline'});
const script = renderer.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8').replace('<!-- RUFUS_RENDERER -->', () => '<script>'+script+'</script>');
const template = readFileSync(resolve(root, 'worker/index.js'), 'utf8');
const marker = '"__ANIMAL_ZOO_HTML_PLACEHOLDER__"';
if (!template.includes(marker)) throw new Error('Missing HTML placeholder');
const build = resolve(root, 'dist');
mkdirSync(resolve(build, 'server'), { recursive: true });
mkdirSync(resolve(build, '.openai'), { recursive: true });
writeFileSync(resolve(build, 'server/index.js'), template.replace(marker, () => JSON.stringify(html)));
copyFileSync(resolve(root, '.openai/hosting.json'), resolve(build, '.openai/hosting.json'));
console.log('Built server/index.js and hosting manifest');
