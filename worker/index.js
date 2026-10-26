// Debatt-AI Animal Zoo: owner-private Cloudflare Worker.
// The build script replaces this constant with the local HTML asset.
const PAGE_HTML = "__ANIMAL_ZOO_HTML_PLACEHOLDER__";
// Rigged Rufus model (base64), or "" when the build found no assets/rufus/rufus.glb.
const RUFUS_GLB_BASE64 = "__RUFUS_GLB_BASE64_PLACEHOLDER__";
let rufusGlb = null;

const MODEL = "gemini-3.8-live";
const SESSION_MS = 3 * 60 * 1000;
const shortWindow = new Map();

const ANIMALS = {
  fox: {
    voice: "Puck",
    prompt: "Du är Räven Rufus, en nyfiken och vänlig tecknad räv i Debatt-AI Animal Zoo. Du är lekfull, lite busig och älskar skog, rymden, vetenskap och roliga gåtor. Tala med naturlig varm svensk röst, svara oftast med 1–3 korta meningar och ställ ibland en rolig följdfråga. Svara tryggt och åldersanpassat. Om någon vill ha råd om farliga saker, ge vänliga säkra alternativ. Du är en AI-figur, aldrig en riktig räv."
  },
  duck: {
    voice: "Leda",
    prompt: "Du är Ankan Doris, en kvick, rolig och vänlig tecknad anka i Debatt-AI Animal Zoo. Du är charmigt självsäker, älskar dammar, uppfinningar, experiment och små ordvitsar. Tala med naturlig svensk röst, svara oftast med 1–3 korta meningar och låt nyfikenheten smitta. Håll samtalet tryggt och åldersanpassat. Säg gärna kvack ibland, men inte i varje svar. Du är en AI-figur, inte en riktig anka."
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
}

function reject(message, status) {
  return json({ error: message }, status);
}

// Only use documented, fixed provider codes in diagnostics. Never relay
// Google's raw error message, since it could include request details.
const PROVIDER_CODES = new Set([
  "INVALID_ARGUMENT", "FAILED_PRECONDITION", "PERMISSION_DENIED", "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED", "NOT_FOUND", "UNAVAILABLE", "INTERNAL",
  "invalid_request", "failed_precondition", "parameter_unknown", "authentication",
  "permission_denied", "payment_required", "not_found", "model_not_found",
  "quota_exceeded", "rate_limit_exceeded", "too_many_requests", "service_unavailable"
]);

const PROVIDER_REASONS = new Set([
  "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_BLOCKED", "API_KEY_SERVICE_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED"
]);

async function classifyProviderError(response) {
  let body;
  try { body = await response.json(); } catch { /* Non-JSON response */ }
  const candidate = body?.error?.status || body?.error?.code;
  const code = PROVIDER_CODES.has(candidate) ? candidate : null;
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const reason = details.map(detail => detail?.reason).find(value => PROVIDER_REASONS.has(value)) || null;
  return { code, reason };
}

function requestToken(apiKey, payload) {
  return fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
}

function providerFailure(status, code, reason, triedMinimal) {
  const suffix = ` (Google HTTP ${status}${code ? `, ${code}` : ""}${reason ? `, ${reason}` : ""}).`;
  if (reason === "API_KEY_INVALID" || reason === "API_KEY_EXPIRED")
    return "Google anger att API-nyckeln är ogiltig eller har gått ut. Kopiera hela nyckeln från Google AI Studio" + suffix;
  if (reason?.startsWith("API_KEY_"))
    return "Google har spärrat API-nyckeln eller begränsat var den får användas. Kontrollera nyckelns status" + suffix;
  if (code === "FAILED_PRECONDITION" || code === "failed_precondition")
    return "Googles projektvillkor är inte uppfyllda. Kontrollera om Free Tier är tillgänglig" + suffix;
  if (status === 400) return (triedMinimal ?
    "Google avvisade även det minimala tokenanropet. Kontrollera projektet och API-nyckeln" :
    "Google avvisade tokenanropet. Kontrollera sessionsparametrar och nyckel") + suffix;
  if (status === 401) return "Google känner inte igen API-nyckeln. Kontrollera att hela nyckeln kopierades" + suffix;
  if (status === 402) return "Google kräver betalning för projektet. Aktivera inte betalning för detta test" + suffix;
  if (status === 403) return "Google nekar projektet åtkomst. Kontrollera projektets Free Tier och modellåtkomst" + suffix;
  if (status === 404) return "Google hittar inte API-tjänsten eller modellen" + suffix;
  if (status === 429) return "Googles anropsgräns är nådd. Prova senare" + suffix;
  if (status >= 500) return "Google rapporterade ett tillfälligt serverfel" + suffix;
  return "Google kunde inte skapa en session" + suffix;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(PAGE_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "permissions-policy": "microphone=(self), camera=()"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/rufus.glb" && RUFUS_GLB_BASE64) {
      rufusGlb ||= Uint8Array.from(atob(RUFUS_GLB_BASE64), c => c.charCodeAt(0));
      return new Response(rufusGlb, {
        headers: {
          "content-type": "model/gltf-binary",
          "cache-control": "private, max-age=3600",
          "x-content-type-options": "nosniff"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json({ ready: Boolean(env.GEMINI_API_KEY), model: MODEL, private: true, limitSeconds: 180 });
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      // The Site is owner-private at the platform boundary. Repeat the identity
      // check here in case the route is ever reused in another context.
      const userId = request.headers.get("oai-authenticated-user-id");
      if (!userId) return reject("Du behöver öppna den privata sidan som inloggad ägare.", 401);
      if (request.headers.get("origin") !== url.origin) return reject("Ogiltigt ursprung.", 403);
      if (!(request.headers.get("content-type") || "").startsWith("application/json")) return reject("Fel format.", 415);
      if (Number(request.headers.get("content-length") || 0) > 4096) return reject("För stor begäran.", 413);

      let input;
      try { input = await request.json(); } catch { return reject("Ogiltig begäran.", 400); }
      const animal = String(input?.animal || "");
      if (!Object.hasOwn(ANIMALS, animal)) return reject("Okänt djur.", 400);
      // Owner-private, single-session bring-your-own-key mode for testing only.
      // Never persist the provided key or return it to the browser.
      const providedKey = input?.apiKey;
      if (providedKey !== undefined &&
          (typeof providedKey !== "string" || providedKey.length > 2048 ||
           /[\u0000-\u001f\u007f]/.test(providedKey))) {
        return reject("API-nyckeln har fel format.", 400);
      }
      const apiKey = env.GEMINI_API_KEY || providedKey;
      if (!apiKey) return reject("Ange Gemini API-nyckeln i det privata testfältet.", 503);

      // Isolate-local abuse throttle, sufficient as a light private-lab guard.
      // This is not a distributed quota and must be replaced before public launch.
      const now = Date.now();
      for (const [id, state] of shortWindow) {
        if (state.resetAt < now) shortWindow.delete(id);
      }
      const state = shortWindow.get(userId) || { last: 0, count: 0, resetAt: now + 3600000 };
      if (state.last && now - state.last < 20000) return reject("Vänta 20 sekunder innan ett nytt försök.", 429);
      if (state.count >= 8) return reject("Testgränsen är nådd i den här serverinstansen. Prova senare.", 429);
      state.last = now;
      state.count += 1;
      shortWindow.set(userId, state);

      const selected = ANIMALS[animal];
      const expiry = new Date(now + SESSION_MS).toISOString();
      const openUntil = new Date(now + 45000).toISOString();
      const payload = {
        uses: 1,
        expireTime: expiry,
        newSessionExpireTime: openUntil,
        liveConnectConstraints: {
          model: `models/${MODEL}`,
          config: { responseModalities: ["AUDIO"] }
        }
      };

      let upstream;
      let diagnostics = null;
      let triedMinimal = false;
      try {
        upstream = await requestToken(apiKey, payload);
        if (!upstream.ok) {
          diagnostics = await classifyProviderError(upstream);
          // 400 INVALID_ARGUMENT is also returned for invalid API keys. Retry
          // only when Google hasn't reported a key problem or prerequisite.
          // The minimal form is documented by Google and still expires after
          // three minutes, allows one session and is owner-private only.
          const prerequisite = diagnostics.code === "FAILED_PRECONDITION" || diagnostics.code === "failed_precondition";
          if (upstream.status === 400 && !diagnostics.reason && !prerequisite) {
            triedMinimal = true;
            upstream = await requestToken(apiKey, {
              uses: 1,
              expireTime: expiry,
              newSessionExpireTime: openUntil
            });
            diagnostics = upstream.ok ? null : await classifyProviderError(upstream);
          }
        }
      } catch {
        return reject("Det gick inte att kontakta Gemini. Försök igen.", 502);
      }
      if (!upstream.ok) {
        // Only emit safe provider status metadata. No raw provider text, request
        // headers, supplied API key or response body is ever logged or returned.
        console.warn("animal_zoo_gemini_token_rejected", JSON.stringify({
          googleHttpStatus: upstream.status, providerCode: diagnostics?.code || null,
          googleReason: diagnostics?.reason || null, triedMinimal
        }));
        return reject(providerFailure(upstream.status, diagnostics?.code, diagnostics?.reason, triedMinimal), upstream.status === 429 ? 429 : 502);
      }
      if (triedMinimal) console.info("animal_zoo_gemini_token_minimal_fallback_succeeded");
      const result = await upstream.json();
      if (typeof result?.name !== "string" || !result.name) return reject("Gemini skickade ett ofullständigt svar.", 502);
      return json({ token: result.name, model: MODEL, voice: selected.voice, prompt: selected.prompt, animal, expiresAt: expiry });
    }
    return reject("Sidan finns inte.", 404);
  }
};
