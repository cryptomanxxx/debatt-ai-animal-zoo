import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign, webcrypto} from 'node:crypto';
import {authorize} from './rufus-model-bridge.mjs';

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
