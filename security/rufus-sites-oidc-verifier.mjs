/**
 * Platform-neutral, DISABLED-BY-DEFAULT GitHub OIDC identity verifier prototype.
 * No HTTP handler, private model access, storage bindings, or deployments.
 * Integrate with Sites only after server-side capabilities are confirmed.
 */
const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = ISSUER + '/.well-known/jwks';
const AUDIENCE = 'debatt-ai-rufus-private-model';
const REPO = 'cryptomanxxx/debatt-ai-animal-zoo';
const REPO_ID = '1433538997';
const OWNER_ID = '48676920';
const WORKFLOW_REF = REPO + '/.github/workflows/rufus-private-blender.yml@refs/heads/main';

function decode(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length > 12000) throw Error('Invalid segment');
  const encoded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
  if (btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') !== segment) throw Error('Invalid encoding');
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function json(bytes) { return JSON.parse(new TextDecoder().decode(bytes)); }
function claimsAllowed(c, now) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (c.iss !== ISSUER || c.aud !== AUDIENCE || c.repository !== REPO) return false;
  if (String(c.repository_id) !== REPO_ID || String(c.repository_owner_id) !== OWNER_ID) return false;
  if (String(c.actor_id) !== OWNER_ID || c.ref !== 'refs/heads/main') return false;
  if (c.event_name !== 'workflow_dispatch' || c.workflow_ref !== WORKFLOW_REF) return false;
  if (c.runner_environment !== 'github-hosted') return false;
  if (c.sub !== 'repo:' + REPO + ':ref:refs/heads/main') return false;
  if (typeof c.run_id !== 'string' || !/^\d+$/.test(c.run_id)) return false;
  if (!Number.isInteger(c.iat) || !Number.isInteger(c.exp)) return false;
  if (c.nbf !== undefined && !Number.isInteger(c.nbf)) return false;
  if (c.iat > now + 30 || c.exp <= now || (c.nbf !== undefined && c.nbf > now + 30)) return false;
  if (c.exp <= c.iat || c.exp - c.iat > 900) return false;
  return true;
}
/**
 * Returns a boolean, never token claims. `enabled` must be explicitly true.
 * fetchJwks is a trusted, server-side fetch implementation; URL is fixed.
 * Does not replace owner-login or authorize model retrieval.
 */
export async function verifyGithubOidc(token, {enabled = false, fetchJwks, subtle = globalThis.crypto?.subtle, now = Math.floor(Date.now()/1000)} = {}) {
  if (enabled !== true || typeof token !== 'string' || token.length > 12000 || typeof fetchJwks !== 'function' || !subtle) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [h,p,s] = parts;
    const header = json(decode(h));
    const claims = json(decode(p));
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 180) return false;
    if ('jku' in header || 'x5u' in header || 'crit' in header || 'jwk' in header) return false;
    if (!claimsAllowed(claims, now)) return false;
    const response = await fetchJwks(JWKS_URL);
    if (!response?.ok) return false;
    const keys = await response.json();
    if (!Array.isArray(keys?.keys) || keys.keys.length > 100) return false;
    const k = keys.keys.find(item => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig' && item.alg === 'RS256');
    if (!k || typeof k.n !== 'string' || typeof k.e !== 'string') return false;
    const publicKey = await subtle.importKey('jwk',{kty:'RSA',n:k.n,e:k.e,alg:'RS256',ext:true,key_ops:['verify']},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return Boolean(await subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decode(s),new TextEncoder().encode(h+'.'+p)));
  } catch { return false; }
}
