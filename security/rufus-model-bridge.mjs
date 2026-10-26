/**
 * Draft only: stand-alone Cloudflare Worker for a PRIVATE R2-bound model.
 * Do not deploy until the bucket and GitHub workflow have been reviewed.
 * Neither this module nor the repo contains the licensed GLB.
 */
const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = ISSUER + '/.well-known/jwks';
const AUDIENCE = 'debatt-ai-rufus-private-model';
const REPO_ID = '1433538997';
const OWNER_ID = '48676920';
const ACTOR_ID = '48676920';
const WORKFLOW_REF = 'cryptomanxxx/debatt-ai-animal-zoo/.github/workflows/rufus-private-blender.yml@refs/heads/main';
const OBJECT_KEY = 'licensed/rufus-original.glb';

function decode(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment)) throw Error('Malformed JWT segment');
  const raw = segment.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(raw + '='.repeat((4 - raw.length % 4) % 4));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}

function parseJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function eligible(claims, now) {
  const safe = value => typeof value === 'string' && value.length > 0;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return false;
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return false;
  if (String(claims.repository_id) !== REPO_ID || String(claims.repository_owner_id) !== OWNER_ID) return false;
  if (String(claims.actor_id) !== ACTOR_ID || claims.repository !== 'cryptomanxxx/debatt-ai-animal-zoo') return false;
  if (claims.ref !== 'refs/heads/main' || claims.event_name !== 'workflow_dispatch') return false;
  if (claims.workflow_ref !== WORKFLOW_REF || claims.runner_environment !== 'github-hosted') return false;
  if (!safe(claims.jti) || !safe(claims.sub) || !safe(claims.run_id)) return false;
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || !Number.isInteger(claims.nbf)) return false;
  if (claims.iat > now + 30 || claims.nbf > now || claims.exp <= now) return false;
  if (claims.exp - claims.iat > 900 || claims.exp <= claims.iat) return false;
  return true;
}

export async function authorize(jwt, fetchKeys = fetch, now = Math.floor(Date.now()/1000)) {
  if (typeof jwt !== 'string' || jwt.length > 12000) return false;
  const segments = jwt.split('.');
  if (segments.length !== 3) return false;
  try {
    const [head, payload, signature] = segments;
    const header = parseJson(decode(head));
    const claims = parseJson(decode(payload));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 180) return false;
    if ('crit' in header || 'jku' in header || 'x5u' in header) return false;
    if (!eligible(claims, now)) return false;
    const response = await fetchKeys(JWKS_URL, {signal:AbortSignal.timeout(5000)});
    if (!response.ok) return false;
    const jwks = await response.json();
    const key = jwks?.keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig' && k.alg === 'RS256');
    if (!key || typeof key.n !== 'string' || typeof key.e !== 'string') return false;
    const publicKey = await crypto.subtle.importKey('jwk', {
      kty:'RSA', n:key.n, e:key.e, alg:'RS256', ext:true, key_ops:['verify']
    }, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(signature),
      new TextEncoder().encode(head + '.' + payload));
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/private-model') return new Response(null,{status:404});
    if (env.MODEL_ACCESS_ENABLED !== 'true' || !env.RUFUS_MODELS) return new Response(null,{status:503});
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('authorization') || '');
    if (!match || !(await authorize(match[1]))) return new Response(null,{status:403,headers:{'cache-control':'no-store'}});
    const asset = await env.RUFUS_MODELS.get(OBJECT_KEY);
    if (!asset) return new Response(null,{status:404});
    return new Response(asset.body,{headers:{
      'content-type':'model/gltf-binary',
      'cache-control':'private, no-store',
      'x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'none'"
    }});
  }
};
