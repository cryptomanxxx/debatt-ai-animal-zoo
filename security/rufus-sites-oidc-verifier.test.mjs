import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign, webcrypto} from 'node:crypto';
import {verifyGithubOidc} from './rufus-sites-oidc-verifier.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test',use:'sig',alg:'RS256'};
const fetchJwks=async url=>{
  assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');
  return {ok:true,json:async()=>({keys:[jwk]})};
};
const now=Math.floor(Date.now()/1000);
const claims={
 iss:'https://token.actions.githubusercontent.com',aud:'debatt-ai-rufus-private-model',
 repository:'cryptomanxxx/debatt-ai-animal-zoo',repository_id:'1433538997',
 repository_owner_id:'48676920',actor_id:'48676920',ref:'refs/heads/main',
 event_name:'workflow_dispatch',runner_environment:'github-hosted',
 workflow_ref:'cryptomanxxx/debatt-ai-animal-zoo/.github/workflows/rufus-sites-oidc-probe.yml@refs/heads/main',
 sub:'repo:cryptomanxxx@48676920/debatt-ai-animal-zoo@1433538997:ref:refs/heads/main',
 run_id:'123',iat:now,exp:now+180
};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=(c=claims,header={})=>{
 const data=encode({alg:'RS256',kid:'test',...header})+'.'+encode(c);
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
};
const options={enabled:true,expectedSubject:claims.sub,fetchJwks,subtle:webcrypto.subtle,now};
test('disabled by default, and missing configured subject is rejected',async()=>{\n assert.equal(await verifyGithubOidc(token(),{...options,expectedSubject:undefined}),false);
 assert.equal(await verifyGithubOidc(token(),{...options,enabled:false}),false);
 assert.equal(await verifyGithubOidc(token()),false);
});
test('accepts only correctly signed and scoped GitHub OIDC',async()=>{
 assert.equal(await verifyGithubOidc(token(),options),true);
 assert.equal(await verifyGithubOidc(token({...claims,nbf:now-1}),options),true);
});
test('rejects wrong or manipulated credentials',async()=>{
 assert.equal(await verifyGithubOidc('bad',options),false);
 const t=token();const [h,p,s]=t.split('.');
 assert.equal(await verifyGithubOidc(h+'.'+p+'.'+s.slice(0,-2)+'xx',options),false);
 assert.equal(await verifyGithubOidc(token({...claims,repository:'other/repo'}),options),false);\n assert.equal(await verifyGithubOidc(token({...claims,sub:'repo:cryptomanxxx/debatt-ai-animal-zoo:ref:refs/heads/main'}),options),false);
 assert.equal(await verifyGithubOidc(token({...claims,ref:'refs/heads/feature'}),options),false);
 assert.equal(await verifyGithubOidc(token({...claims,workflow_ref:'other'}),options),false);
 assert.equal(await verifyGithubOidc(token({...claims,aud:'wrong'}),options),false);
 assert.equal(await verifyGithubOidc(token({...claims,exp:now-1}),options),false);
 assert.equal(await verifyGithubOidc(token({...claims,exp:now+2000}),options),false);
 assert.equal(await verifyGithubOidc(token(claims,{jku:'https://evil.example'}),options),false);
 assert.equal(await verifyGithubOidc(token(claims,{alg:'none'}),options),false);
});
test('fails closed if GitHub JWKS unavailable',async()=>{
 assert.equal(await verifyGithubOidc(token(),{...options,fetchJwks:async()=>({ok:false})}),false);
});
