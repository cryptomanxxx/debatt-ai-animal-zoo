import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import zoo from '../dist/server/index.js';

const base = 'https://example.chatgpt.site';
const post = (animal, headers={}, extra={}) => new Request(base+'/api/session',{
  method:'POST',
  headers:{'content-type':'application/json',origin:base,...headers},
  body:JSON.stringify({animal,...extra})
});

const status=await zoo.fetch(new Request(base+'/api/status'),{});
assert.equal(status.status,200);
assert.equal((await status.json()).ready,false);

const page=await zoo.fetch(new Request(base+'/'),{});
assert.equal(page.status,200);
const html=await page.text();
assert.ok(html.includes('Räven Rufus'));
assert.ok(html.includes('Ankan Doris'));
assert.ok(html.includes('BidiGenerateContentConstrained'));
assert.ok(html.includes('id="api-key"'));
assert.ok(html.includes('id="clear-api-key"'));
assert.ok(html.includes('id="mic-diagnostics"'));
assert.ok(html.includes('id="mic-meter-fill"'));
assert.ok(html.includes('id="finish-speech"'));
assert.ok(html.includes('audioStreamEnd:true'));
assert.ok(html.includes('id="start-stt"'));
assert.ok(html.includes('id="recognize-speech"'));
assert.ok(html.includes('id="speech-transcript"'));
assert.ok(html.includes('id="live-transcript"'));
assert.ok(html.includes('webkitSpeechRecognition'));
assert.ok(html.includes('class="fox-ear left"'));
assert.equal((html.match(/class="eyelid"/g)||[]).length,4);
assert.ok(html.includes('outAnalyser.getByteTimeDomainData'));
assert.ok(html.includes("const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches"));
assert.ok(html.includes('String(reduced ? 0.16 : level)'));
assert.ok(html.includes('audioSegments.some(seg=>seg.start<=now&&now<seg.end)'));
assert.ok(html.includes('setTimeout(blink,2300+Math.random()*4200)'));
assert.ok(html.includes("say.onstart=()=>$('stage').classList.add('is-previewing')"));
assert.ok(!html.includes("source.connect(outCtx.destination)"));
assert.ok(html.includes('interimInputTranscription'));
assert.ok(html.includes("micPaused=true;ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}))"));
assert.ok(html.includes('if(!connected||micPaused||!ws'));
assert.ok(html.includes('micAudiblePackets'));
assert.ok(!html.includes('localStorage'));
assert.ok(!html.includes('sessionStorage'));
assert.ok(!html.includes("finally{$('api-key').value=''}"));
assert.ok(!html.includes('__ANIMAL_ZOO_HTML_PLACEHOLDER__'));
const inlineScript=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript);
for (const [i,match] of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries()) new Script(match[1],{filename:`animal-zoo-browser-${i}.js`});
assert.equal([...html.matchAll(/<script>/g)].length,2);
assert.ok(!html.includes('<!-- RUFUS_RENDERER -->'));

assert.equal((await zoo.fetch(post('fox'),{GEMINI_API_KEY:'test'})).status,401);
assert.equal((await zoo.fetch(post('fox',{'oai-authenticated-user-id':'test',origin:'https://wrong.site'}),{GEMINI_API_KEY:'test'})).status,403);
assert.equal((await zoo.fetch(post('lion',{'oai-authenticated-user-id':'test'}),{GEMINI_API_KEY:'test'})).status,400);
assert.equal((await zoo.fetch(post('fox',{'oai-authenticated-user-id':'test'}),{})).status,503);
assert.equal((await zoo.fetch(post('fox',{'oai-authenticated-user-id':'test'}, {apiKey:{secret:'bad'}}),{})).status,400);
assert.equal((await zoo.fetch(post('fox',{'oai-authenticated-user-id':'test'}, {apiKey:'A'.repeat(2049)}),{})).status,400);
assert.equal((await zoo.fetch(post('fox',{'oai-authenticated-user-id':'test'}, {apiKey:'key\nheader'}),{})).status,400);

const oldFetch=globalThis.fetch;
let seen;
globalThis.fetch=async (url,init)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/auth_tokens');
  assert.equal(init.headers['x-goog-api-key'],'test-key');
  seen=JSON.parse(init.body);
  return new Response(JSON.stringify({name:'short-lived-test-token'}),{status:200});
};
try{
  const result=await zoo.fetch(post('fox',{'oai-authenticated-user-id':'first-user'}),{GEMINI_API_KEY:'test-key'});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.voice,'Puck');
  assert.equal(body.model,'gemini-3.8-live');
  assert.equal(body.token,'short-lived-test-token');
  assert.equal(seen.uses,1);
  assert.equal(seen.liveConnectConstraints.model,'models/gemini-3.8-live');
  assert.ok(Date.parse(seen.expireTime)-Date.now()<=180000);
  assert.ok(Date.parse(seen.expireTime)-Date.now()>170000);
  const limited=await zoo.fetch(post('fox',{'oai-authenticated-user-id':'first-user'}),{GEMINI_API_KEY:'test-key'});
  assert.equal(limited.status,429);
  // Auth keys can use punctuation beyond legacy Google API key characters.
  const byokKey='auth:v2.example/key+with=punctuation';
  const original=globalThis.fetch;
  globalThis.fetch=async (url,init)=>{
    assert.equal(init.headers['x-goog-api-key'],byokKey);
    return new Response(JSON.stringify({name:'byok-test-token'}),{status:200});
  };
  const byok=await zoo.fetch(post('duck',{'oai-authenticated-user-id':'second-user'},{apiKey:byokKey}),{});
  assert.equal(byok.status,200);
  assert.equal((await byok.json()).token,'byok-test-token');
  globalThis.fetch=original;

  const failures = [
    [400,'INVALID_ARGUMENT','minimala tokenanropet',502],
    [400,'FAILED_PRECONDITION','Free Tier',502],
    [401,'UNAUTHENTICATED','API-nyckeln',502],
    [402,'payment_required','betalning',502],
    [403,'PERMISSION_DENIED','åtkomst',502],
    [404,'NOT_FOUND','hittar inte',502],
    [429,'RESOURCE_EXHAUSTED','anropsgräns',429],
    [503,'UNAVAILABLE','serverfel',502]
  ];
  for (const [index,[statusCode, googleCode, phrase, expectedStatus]] of failures.entries()) {
    const fakeSecret=`private-test-secret-${statusCode}`;
    let calls=0;
    globalThis.fetch=async ()=>{calls++;return new Response(JSON.stringify({
      error:{status:googleCode,message:`Sensitive user key ${fakeSecret}`}
    }),{status:statusCode})};
    const warnings=[];
    const oldWarn=console.warn;
    console.warn=(...args)=>warnings.push(args.join(' '));
    try {
      const failed=await zoo.fetch(post('fox',{'oai-authenticated-user-id':`err-${index}`},{apiKey:fakeSecret}),{});
      assert.equal(failed.status,expectedStatus);
      const error=(await failed.json()).error;
      assert.ok(error.includes(phrase),`Missing hint for HTTP ${statusCode}: ${error}`);
      assert.ok(error.includes(`Google HTTP ${statusCode}`));
      assert.ok(!error.includes(fakeSecret));
      assert.equal(warnings.length,1);
      assert.ok(warnings[0].includes(`"googleHttpStatus":${statusCode}`));
      assert.ok(!warnings[0].includes(fakeSecret));
      assert.equal(calls, statusCode===400 && googleCode==='INVALID_ARGUMENT' ? 2 : 1);
    } finally { console.warn=oldWarn; }
  }

  // A 400 INVALID_ARGUMENT can mean a bad key, not just a bad token payload.
  let invalidKeyCalls=0;
  const invalidKey='private-invalid-key-that-must-not-be-logged';
  globalThis.fetch=async ()=>{
    invalidKeyCalls++;
    return new Response(JSON.stringify({error:{
      status:'INVALID_ARGUMENT',message:`The key ${invalidKey} is invalid`,
      details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'API_KEY_INVALID'}]
    }}),{status:400});
  };
  const invalidWarnings=[];
  const oldWarn=console.warn;
  console.warn=(...args)=>invalidWarnings.push(args.join(' '));
  try {
    const invalid=await zoo.fetch(post('fox',{'oai-authenticated-user-id':'bad-key'},{apiKey:invalidKey}),{});
    const error=(await invalid.json()).error;
    assert.equal(invalid.status,502);
    assert.equal(invalidKeyCalls,1,'Do not retry invalid keys');
    assert.ok(error.includes('API_KEY_INVALID'));
    assert.ok(error.includes('ogiltig'));
    assert.ok(!error.includes(invalidKey));
    assert.ok(invalidWarnings[0].includes('API_KEY_INVALID'));
    assert.ok(!invalidWarnings[0].includes(invalidKey));
  } finally {console.warn=oldWarn;}

  // When the constrained request is rejected, try Google's documented minimal
  // one-use form without broadening the three-minute/45-second time windows.
  const fallbackKey='test-key-for-minimal-fallback';
  let fallbackCalls=0;
  const oldInfo=console.info;
  const info=[];
  console.info=(...args)=>info.push(args.join(' '));
  globalThis.fetch=async (_url,init)=>{
    assert.equal(init.headers['x-goog-api-key'],fallbackKey);
    const payload=JSON.parse(init.body);
    fallbackCalls++;
    if (fallbackCalls===1) {
      assert.ok(payload.liveConnectConstraints);
      return new Response(JSON.stringify({error:{status:'INVALID_ARGUMENT'}}),{status:400});
    }
    assert.equal(payload.uses,1);
    assert.ok(!('liveConnectConstraints' in payload));
    assert.ok(Date.parse(payload.expireTime)-Date.now()<=180000);
    assert.ok(Date.parse(payload.newSessionExpireTime)-Date.now()<=45000);
    return new Response(JSON.stringify({name:'minimal-success-token'}),{status:200});
  };
  try {
    const fallback=await zoo.fetch(post('duck',{'oai-authenticated-user-id':'minimal-test'},{apiKey:fallbackKey}),{});
    assert.equal(fallback.status,200);
    assert.equal((await fallback.json()).token,'minimal-success-token');
    assert.equal(fallbackCalls,2);
    assert.equal(info.length,1);
    assert.ok(!info[0].includes(fallbackKey));
  } finally {console.info=oldInfo;}
} finally {globalThis.fetch=oldFetch}
console.log('Animal Zoo: private-site, sanitized provider reasons, minimal token fallback and Gemini session checks passed.');

await import('./test-rufus.mjs');
await import('./test-rufus-lifecycle.mjs');
