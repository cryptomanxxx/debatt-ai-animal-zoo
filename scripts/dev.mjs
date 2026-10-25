// Local visual QA server only. The hosted app uses dist/server/index.js.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const htmlPath = resolve(import.meta.dirname, '../web/index.html');
const portArg = process.argv.indexOf('--port');
const port = Number((portArg>=0&&process.argv[portArg+1])||process.env.PORT||3000);
createServer((req,res)=>{
  if(req.url==='/api/status'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ready:false,private:true}));
  }else if(req.url==='/'||req.url==='/index.html'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(readFileSync(htmlPath));
  }else{
    res.writeHead(404);res.end('Not found');
  }
}).listen(port,'0.0.0.0',()=>console.log('Animal Zoo preview listening on '+port));
