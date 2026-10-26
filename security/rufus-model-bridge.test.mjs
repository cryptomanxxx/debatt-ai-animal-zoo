import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign, webcrypto} from 'node:crypto';
import bridge, {authorize} from './rufus-model-bridge.mjs';

Object.defineProperty(globalThis, 'crypto', {value:webcrypto, configurable:true});
const {privateKey, publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const key = {...publicKey.export({format:'jwk'}), kid:'test-key', use:'sig', alg:'RS256'};
const keyFetch = async url => {
  assert.equal(url, 'https://token.actions.githubusercontent.com/.well-known/jwks');
  return {ok:true, json:async()=>({keys:[key]})};
};
const now = Math.floor(Date.now()/1000);
const good = {
  iss:'https://token.actions.githubusercontent.com',
  aud:'debatt-ai-rufus-private-model',
  repository:'cryptomanxxx/debatt-ai-animal-zoo',
  repository_id:'1433538997',
  repository_owner_id:'48676920',
  actor_id:'48676920',
  ref:'refs/heads/main',
  workflow_ref:'cryptomanxxx/debatt-ai-animal-zoo/.github/workflows/rufus-private-blender.yml@refs/heads/main',
  event_name:'workflow_dispatch',runner_environment:'github-hosted',
  sub:'repo:cryptomanxxx/debatt-ai-animal-zoo:ref:refs/heads/main',
  run_id:'123',jti:'unique-test',iat:now,nbf:now-1,exp:now+180
};
const b64 = data => Buffer.from(JSON.stringify(data)).toString('base64url');
function token(claims = good, {alg='RS256', keyPair=privateKey, extraHeader={}}={}) {
  const data = b64({alg,kid:'test-key',...extraHeader})+'.'+b64(claims);
  const signature = sign('RSA-SHA256', Buffer.from(data), keyPair).toString('base64url');
  return data+'.'+signature;
}
test('only a signed token from authorized main workflow is accepted',async()=>{
  assert.equal(await authorize(token(),keyFetch,now),true);
});
test('rejects malformed or manipulated signatures',async()=>{
  assert.equal(await authorize('bad',keyFetch,now),false);
  const jwt=token();
  assert.equal(await authorize(jwt.slice(0,-1)+(jwt.at(-1)==='A'?'B':'A'),keyFetch,now),false);
  assert.equal(await authorize(token(good,{alg:'none'}),keyFetch,now),false);
  assert.equal(await authorize(token(good,{extraHeader:{jku:'https://attacker.example/jwks'}}),keyFetch,now),false);
});
for(const [name,value] of Object.entries({
  repository_id:'another',repository_owner_id:'another',actor_id:'another',
  repository:'attacker/other',ref:'refs/heads/evil',event_name:'pull_request',
  workflow_ref:'cryptomanxxx/debatt-ai-animal-zoo/.github/workflows/other.yml@refs/heads/main',
  runner_environment:'self-hosted',aud:'wrong',iss:'https://attacker.example',
  exp:now-1,iat:now+100,nbf:now+100
})){
  test('denies unexpected claim '+name,async()=>{
    assert.equal(await authorize(token({...good,[name]:value}),keyFetch,now),false);
  });
}
test('denies JWKS outage and oversized token lifetimes',async()=>{
  assert.equal(await authorize(token(),async()=>({ok:false}),now),false);
  assert.equal(await authorize(token({...good,exp:now+1000}),keyFetch,now),false);
});

test('bridge is disabled and never reads R2 without explicit enablement',async()=>{
  const calls=[];
  const env={RUFUS_MODELS:{get:async key=>{calls.push(key);return {body:new Uint8Array([1,2,3])}}}};
  const response=await bridge.fetch(new Request('https://bridge.example/private-model',{headers:{authorization:'Bearer '+token()}}),env);
  assert.equal(response.status,503);
  assert.deepEqual(calls,[]);
});
test('bridge rejects unauthenticated or wrong workflow before reading R2',async()=>{
  const calls=[];
  const env={MODEL_ACCESS_ENABLED:'true',RUFUS_MODELS:{get:async key=>{calls.push(key);return {body:new Uint8Array([1,2,3])}}}};
  const previous=globalThis.fetch;globalThis.fetch=keyFetch;
  try {
    assert.equal((await bridge.fetch(new Request('https://bridge.example/private-model'),env)).status,403);
    assert.equal((await bridge.fetch(new Request('https://bridge.example/other'),env)).status,404);
    assert.equal((await bridge.fetch(new Request('https://bridge.example/private-model',{method:'POST'}),env)).status,404);
    assert.equal((await bridge.fetch(new Request('https://bridge.example/private-model',{headers:{authorization:'Bearer '+token({...good,ref:'refs/heads/evil'})}}),env)).status,403);
    assert.deepEqual(calls,[]);
  } finally {globalThis.fetch=previous}
});
test('bridge serves only fixed R2 object to signed authorized run',async()=>{
  const calls=[], bytes=new Uint8Array([0x67,0x6c,0x54,0x46]);
  const env={MODEL_ACCESS_ENABLED:'true',RUFUS_MODELS:{get:async key=>{calls.push(key);return {body:bytes}}}};
  const previous=globalThis.fetch;globalThis.fetch=keyFetch;
  try {
    const response=await bridge.fetch(new Request('https://bridge.example/private-model?key=another-file',{headers:{authorization:'Bearer '+token()}}),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    assert.deepEqual(calls,['licensed/rufus-original.glb']);
  } finally {globalThis.fetch=previous}
});
