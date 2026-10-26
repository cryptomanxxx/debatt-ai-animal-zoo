// Local visual QA server only. The hosted app uses dist/server/index.js.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, [new URL('./build.mjs', import.meta.url).pathname]);
const { default: worker } = await import('../dist/server/index.js');


const portArg = process.argv.indexOf('--port');
const port = Number((portArg>=0&&process.argv[portArg+1])||process.env.PORT||3000);
createServer((req,res)=>{
  if(req.url==='/qa'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(readFileSync(new URL('./qa.html',import.meta.url)));
  }else if(req.url==='/api/status'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ready:false,private:true}));
  }else if(req.url==='/'||req.url==='/index.html'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    worker.fetch(new Request('http://localhost/'),{}).then(r=>r.text()).then(html=>res.end(html));
  }else{
    // Everything else (e.g. /rufus.glb) is answered by the built Worker, as when hosted.
    worker.fetch(new Request('http://localhost'+req.url,{method:req.method}),{}).then(async r=>{
      res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
    });
  }
}).listen(port,'0.0.0.0',()=>console.log('Animal Zoo preview listening on '+port));
