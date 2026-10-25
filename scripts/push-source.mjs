// One-off local transport helper, receives a Sites credential on stdin.
// Never persists or prints credentials. The remote contains no tokens.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const root=resolve(import.meta.dirname,'..');
if(process.stdin.isTTY)spawnSync('stty',['-echo'],{stdio:'inherit'});
console.log('Ready for hidden Site credential JSON on stdin.');
let input='';
await new Promise(resolve=>process.stdin.on('data',chunk=>{
  input+=chunk.toString();
  if(input.includes('\n'))resolve();
}));
process.stdin.pause();
if(process.stdin.isTTY)spawnSync('stty',['echo'],{stdio:'inherit'});
const credential=JSON.parse(input).credential;
if(!credential?.remote_url||!credential?.token)throw Error('Missing source credential');
function git(args,env=process.env){
  const result=spawnSync('git',args,{cwd:root,env,encoding:'utf8'});
  if(result.status!==0){process.stderr.write((result.stderr||'Git error')+'\n');process.exit(1)}
  return result.stdout.trim();
}
if(!existsSync(resolve(root,'.git')))git(['init','-b','main']);
git(['config','user.name','ChatGPT Site Builder']);
git(['config','user.email','chatgpt-site-builder@users.noreply.github.com']);
git(['add','.']);
if(git(['status','--porcelain']))git(['commit','-m','Build private Animal Zoo Gemini Live prototype']);
if(!git(['remote']))git(['remote','add','origin',credential.remote_url]);
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Bearer '+credential.token};
git(['push','--set-upstream','origin','main'],env);
console.log(JSON.stringify({commit_sha:git(['rev-parse','HEAD']),pushed:true}));
