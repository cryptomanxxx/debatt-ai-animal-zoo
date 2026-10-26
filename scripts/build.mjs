import { build as bundle } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Optional rigged model from `npm run rig`. It is git-ignored, so CI builds without it.
const glbPath = resolve(root, process.env.RUFUS_GLB || 'assets/rufus/rufus.glb');
const MAX_GLB_BYTES = 3_000_000;
let glb = null;
if (existsSync(glbPath)) {
  if (statSync(glbPath).size > MAX_GLB_BYTES) throw new Error(`${glbPath} exceeds ${MAX_GLB_BYTES} bytes; lower --max-texture in npm run rig`);
  glb = readFileSync(glbPath);
  if (glb.toString('latin1', 0, 4) !== 'glTF') throw new Error(`${glbPath} is not a GLB file`);
}
const renderer = await bundle({entryPoints:[resolve(root,'web/rufus/entry.js')],bundle:true,write:false,minify:true,format:'iife',target:'es2020',legalComments:'inline',
  define:glb?{RUFUS_GLB_URL:JSON.stringify('/rufus.glb')}:{}});
const script = renderer.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8').replace('<!-- RUFUS_RENDERER -->', () => '<script>'+script+'</script>');
const template = readFileSync(resolve(root, 'worker/index.js'), 'utf8');
const marker = '"__ANIMAL_ZOO_HTML_PLACEHOLDER__"';
const glbMarker = '"__RUFUS_GLB_BASE64_PLACEHOLDER__"';
if (!template.includes(marker)) throw new Error('Missing HTML placeholder');
if (!template.includes(glbMarker)) throw new Error('Missing GLB placeholder');
const build = resolve(root, 'dist');
mkdirSync(resolve(build, 'server'), { recursive: true });
mkdirSync(resolve(build, '.openai'), { recursive: true });
writeFileSync(resolve(build, 'server/index.js'), template.replace(marker, () => JSON.stringify(html)).replace(glbMarker, () => JSON.stringify(glb ? glb.toString('base64') : '')));
copyFileSync(resolve(root, '.openai/hosting.json'), resolve(build, '.openai/hosting.json'));
console.log('Built server/index.js and hosting manifest' + (glb ? ` with rigged Rufus GLB (${(glb.length / 1e6).toFixed(2)} MB)` : ' (procedural Rufus; no rigged GLB found)'));
