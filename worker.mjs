/**
 * CHOG TRIALS — holder gate
 * Cloudflare Worker. No dependencies: WebCrypto only.
 *
 * The rule this file exists to enforce:
 *   The app secret never leaves the server, and the trials HTML is never
 *   served to a request that has not proved, moments ago, that it controls a
 *   wallet holding the CHOG NFT.
 *
 * Flow
 *   POST /api/gate/session   Bearer <Privy access token>
 *        -> verify JWT signature against Privy's JWKS
 *        -> read the user's linked wallets from Privy (server-side, with secret)
 *        -> eth_call balanceOf(CHOG) on every wallet
 *        -> if any wallet holds one: set a signed, short-lived cookie
 *   GET  /api/gate/status    -> is this cookie still valid (no RPC, no Privy)
 *   POST /api/gate/refresh   -> re-check the chain for the cookie's wallet
 *   GET  /trials             -> serve the trials ONLY with a valid cookie
 *
 * Env (set with `wrangler secret put`, never in the HTML):
 *   PRIVY_APP_ID, PRIVY_APP_SECRET, GATE_SECRET,
 *   CHOG_CONTRACT, CHAIN_RPC_URL
 * Vars (wrangler.toml):
 *   CHOG_STANDARD = "erc721" | "erc1155"
 *   SESSION_TTL   = seconds (default 600)
 */

const PRIVY_BASE = 'https://auth.privy.io/api/v1';
const SESSION_COOKIE = 'trials_session';

/* ---------------------------------------------------------------- helpers */

const enc = new TextEncoder();

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncode(bytes) {
  let bin = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}
function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/* ------------------------------------------------------- JWT verification */

let jwksCache = { at: 0, keys: null };

async function getJwks(env) {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.at < 3600_000) return jwksCache.keys;
  const url = env.PRIVY_JWKS_URL || `${PRIVY_BASE}/apps/${env.PRIVY_APP_ID}/jwks.json`;
  const res = await fetch(url, { headers: { 'privy-app-id': env.PRIVY_APP_ID } });
  if (!res.ok) throw new Error('jwks_unavailable');
  const body = await res.json();
  jwksCache = { at: now, keys: body.keys || [] };
  return jwksCache.keys;
}

/**
 * Verifies a Privy access token offline.
 * Returns { did } on success, throws on anything else.
 */
async function verifyPrivyToken(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed_token');

  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { throw new Error('malformed_token'); }

  if (header.alg !== 'ES256') throw new Error('bad_alg');

  const keys = await getJwks(env);
  /* exact kid only. Falling back to keys[0] means a token whose header names a
     key we do not trust can still be checked against one we do - and if the
     rotation ever lines up, it passes. */
  if (!header.kid) throw new Error('no_kid');
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown_kid');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );

  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64urlToBytes(parts[2]),
    enc.encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw new Error('bad_signature');

  const now = Math.floor(Date.now() / 1000);
  /* an absent exp used to mean "never expires" - a token minted without one
     would have been accepted forever */
  if (typeof payload.exp !== 'number') throw new Error('no_expiry');
  if (payload.exp < now) throw new Error('expired');
  if (typeof payload.iat === 'number' && payload.iat > now + 60) throw new Error('issued_in_future');
  if (payload.aud !== env.PRIVY_APP_ID) throw new Error('bad_audience');
  if (payload.iss !== 'privy.io') throw new Error('bad_issuer');
  if (!payload.sub) throw new Error('no_subject');

  return { did: payload.sub, exp: payload.exp };
}

/* ------------------------------------------------------------- Privy user */

async function getPrivyWallets(did, env) {
  const auth = 'Basic ' + btoa(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`);
  const res = await fetch(`${PRIVY_BASE}/users/${encodeURIComponent(did)}`, {
    headers: { authorization: auth, 'privy-app-id': env.PRIVY_APP_ID },
  });
  if (!res.ok) throw new Error('privy_user_fetch_failed');
  const user = await res.json();

  const wallets = [];
  for (const acc of user.linked_accounts || []) {
    if (acc.type === 'wallet' && (acc.chain_type === 'ethereum' || !acc.chain_type) && acc.address) {
      wallets.push(acc.address.toLowerCase());
    }
    if (acc.type === 'smart_wallet' && acc.address) wallets.push(acc.address.toLowerCase());
  }
  return [...new Set(wallets)].slice(0, 10);
}

/* --------------------------------------------------------- chain: balance */

function padAddress(addr) {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/**
 * Reads balances for every allowed collection in ONE request.
 *
 * There is no single Chog contract - there are several collections, each with
 * its own address. So the gate takes an allowlist (CHOG_CONTRACTS) and asks
 * about all of them at once using a JSON-RPC batch: one HTTP round trip, N
 * eth_calls, instead of N round trips against a rate-limited public node.
 */
function contractsFrom(env) {
  const raw = env.CHOG_CONTRACTS || env.CHOG_CONTRACT || '';
  return String(raw)
    .split(/[,\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    .slice(0, 40);
}

function callData(addr, env) {
  const standard = (env.CHOG_STANDARD || 'erc721').toLowerCase();
  if (standard === 'erc1155') {
    return '0x00fdd58e' + padAddress(addr) + String(env.CHOG_TOKEN_ID || '0').padStart(64, '0');
  }
  return '0x70a08231' + padAddress(addr); // balanceOf(address)
}

async function balancesFor(wallet, env) {
  const contracts = contractsFrom(env);
  if (!contracts.length) throw new Error('no_contracts_configured');

  const data = callData(wallet, env);
  const batch = contracts.map((c, i) => ({
    jsonrpc: '2.0', id: i + 1, method: 'eth_call',
    params: [{ to: c, data }, 'latest'],
  }));

  const res = await fetch(env.CHAIN_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
  });
  if (!res.ok) throw new Error('rpc_http_' + res.status);
  const body = await res.json();

  /* A node that refuses batches returns one object instead of an array.
     Falling back to one call per contract is slow but never wrong. */
  if (!Array.isArray(body)) {
    const out = new Map();
    for (const c of contracts) {
      try {
        const r = await fetch(env.CHAIN_RPC_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c, data }, 'latest'] }),
        });
        const b = await r.json();
        out.set(c, b.result && b.result !== '0x' ? Number(BigInt(b.result)) : 0);
      } catch { out.set(c, 0); }
    }
    return out;
  }

  const out = new Map();
  for (const item of body) {
    const c = contracts[(item.id | 0) - 1];
    if (!c) continue;
    if (item.error || !item.result || item.result === '0x') { out.set(c, 0); continue; }
    try { out.set(c, Number(BigInt(item.result))); } catch { out.set(c, 0); }
  }
  for (const c of contracts) if (!out.has(c)) out.set(c, 0);
  return out;
}

async function findHolder(wallets, env) {
  for (const w of wallets) {
    const balances = await balancesFor(w, env);
    let total = 0;
    const held = [];
    for (const [address, n] of balances) {
      if (n > 0) { total += n; held.push({ address, balance: n }); }
    }
    if (total > 0) return { wallet: w, count: total, collections: held };
  }
  return null;
}

/* ------------------------------------------------------- signed session */

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode(env.GATE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(payload, env) {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body));
  return body + '.' + b64urlEncode(sig);
}

async function readSession(token, env) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlToBytes(sig), enc.encode(body));
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); } catch { return null; }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function sessionCookie(token, ttl) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttl}`;
}

/* --------------------------------------------------------------- limits */

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const rec = hits.get(key) || { n: 0, at: now };
  if (now - rec.at > windowMs) { rec.n = 0; rec.at = now; }
  rec.n++;
  hits.set(key, rec);
  if (hits.size > 5000) hits.clear();
  return rec.n > max;
}

/* ---------------------------------------------------------------- routes */

async function handleSession(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (limited('s:' + ip, 20, 60_000)) return json({ ok: false, reason: 'rate_limited' }, 429);

  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ ok: false, reason: 'missing_token' }, 401);

  let claims;
  try {
    claims = await verifyPrivyToken(token, env);
  } catch (e) {
    /* deliberately no detail: 'bad_signature' vs 'bad_audience' tells an
       attacker which part of their forgery to fix next */
    return json({ ok: false, reason: 'invalid_token' }, 401);
  }

  let wallets;
  try {
    wallets = await getPrivyWallets(claims.did, env);
  } catch (e) {
    return json({ ok: false, reason: 'privy_unavailable' }, 502);
  }
  if (!wallets.length) return json({ ok: false, reason: 'no_wallet' }, 403);

  let holder;
  try {
    holder = await findHolder(wallets, env);
  } catch (e) {
    return json({ ok: false, reason: 'chain_unavailable' }, 502);
  }
  if (!holder) return json({ ok: false, reason: 'not_a_holder', wallets }, 403);

  const ttl = Number(env.SESSION_TTL || 600);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token2 = await signSession({ w: holder.wallet, n: holder.count, exp }, env);

  return json(
    { ok: true, wallet: holder.wallet, count: holder.count, collections: holder.collections, exp },
    200,
    { 'set-cookie': sessionCookie(token2, ttl) }
  );
}

async function handleStatus(request, env) {
  const s = await readSession(getCookie(request, SESSION_COOKIE), env);
  if (!s) return json({ ok: false });
  return json({ ok: true, wallet: s.w, count: s.n, exp: s.exp });
}

async function handleRefresh(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (limited('r:' + ip, 30, 60_000)) return json({ ok: false, reason: 'rate_limited' }, 429);

  const s = await readSession(getCookie(request, SESSION_COOKIE), env);
  if (!s) return json({ ok: false, reason: 'no_session' }, 401);

  let n = 0;
  try {
    const balances = await balancesFor(s.w, env);
    for (const v of balances.values()) n += v;
  } catch { return json({ ok: false, reason: 'chain_unavailable' }, 502); }

  if (n <= 0) {
    // the NFT moved: drop the session immediately
    return json({ ok: false, reason: 'no_longer_a_holder' }, 403,
      { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }
  const ttl = Number(env.SESSION_TTL || 600);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = await signSession({ w: s.w, n, exp }, env);
  return json({ ok: true, wallet: s.w, count: n, exp }, 200, { 'set-cookie': sessionCookie(token, ttl) });
}

const JUDGE_COOKIE = 'trials_judge';

async function handleTrials(request, env) {
  /* a judge pass is a signed token like a session, but it carries no wallet.
     It is only ever minted by /trials?judge=<JUDGE_KEY>, so it cannot be
     obtained by the public - the holder gate still applies to everyone else. */
  const s = (await readSession(getCookie(request, SESSION_COOKIE), env))
         || (await readSession(getCookie(request, JUDGE_COOKIE), env));
  if (!s) {
    return new Response('<!doctype html><meta charset=utf-8><title>Holders only</title>' +
      '<body style="background:#05030A;color:#F2EAFF;font:600 15px system-ui;display:grid;place-items:center;height:100vh;margin:0">' +
      '<div style="text-align:center;max-width:320px"><h1 style="font-size:20px;letter-spacing:.14em">HOLDERS ONLY</h1>' +
      '<p style="color:#9b93b8;font-weight:400;line-height:1.6">Connect a wallet holding a Chog to open Chog Trials.</p></div></body>',
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const asset = await env.ASSETS.fetch(new Request(new URL('/chog-trials.html', request.url), request));
  const res = new Response(asset.body, asset);
  res.headers.set('cache-control', 'private, no-store, max-age=0');
  res.headers.set('x-robots-tag', 'noindex');
  res.headers.set('content-type', 'text/html; charset=utf-8');
  res.headers.set('x-frame-options', 'SAMEORIGIN');
  res.headers.set('referrer-policy', 'no-referrer');
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/gate/session' && request.method === 'POST') return await handleSession(request, env);
      if (path === '/api/gate/status') return await handleStatus(request, env);
      if (path === '/api/gate/refresh' && request.method === 'POST') return await handleRefresh(request, env);
      if (path === '/trials') {
        /* ?judge=<key> mints a 48h pass and redirects to a clean URL, so the
           key never sits in the address bar or in a shared screenshot. */
        const jk = url.searchParams.get('judge');
        if (jk && env.JUDGE_KEY) {
          const a = enc.encode(jk), b = enc.encode(env.JUDGE_KEY);
          let diff = a.byteLength ^ b.byteLength;
          for (let i = 0; i < Math.max(a.byteLength, b.byteLength); i++) {
            diff |= (a[i] || 0) ^ (b[i] || 0);
          }
          if (diff === 0) {
            const ttl = 48 * 3600;
            const token = await signSession({ w: 'judge', exp: Math.floor(Date.now() / 1000) + ttl }, env);
            const res = new Response(null, { status: 302, headers: { location: '/trials', 'cache-control': 'no-store' } });
            res.headers.append('set-cookie',
              `${JUDGE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttl}`);
            return res;
          }
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response('Method not allowed', { status: 405, headers: { 'cache-control': 'no-store' } });
        }
        return await handleTrials(request, env);
      }
      /* The file is only ever reachable through /trials. Without this, a static
         asset binding serves it to anyone who guesses the name. */
      /* Cloudflare rewrites *.html to a clean URL, so /chog-trials.html became
         /chog-trials and slipped past the check. Block every alias, and the
         asset itself now lives under a non-HTML name. */
      const banned = /(^|\/)(chog-trials(\.html)?\/?|trials\.asset)$/i;  // every alias html_handling can mint
      if (banned.test(path)) {
        return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
      }
      /* the repo root is served as static assets, so hide our own source */
      if (path === '/_worker.js' || path === '/wrangler.toml' || path.startsWith('/gate/')) {
        return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
      }
      /* the shell is served through here purely to attach security headers */
      if (path === '/' || path === '/index.html') {
        /* pass the request through untouched. Rewriting it to /index.html made
           Cloudflare redirect back to /, and we followed it forever. */
        const asset = await env.ASSETS.fetch(request);
        const res = new Response(asset.body, asset);
        res.headers.set('content-type', 'text/html; charset=utf-8');
  res.headers.set('x-frame-options', 'SAMEORIGIN');
        res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
        res.headers.set('x-content-type-options', 'nosniff');
        res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        return res;
      }
      if (path === '/api/gate/health') {
        const n = contractsFrom(env).length;
        return json({ ok: n > 0, contracts: n, standard: (env.CHOG_STANDARD || 'erc721') });
      }
    } catch (e) {
      return json({ ok: false, reason: 'server_error' }, 500);
    }

    return env.ASSETS.fetch(request);
  },
};

/* exported for the local test harness */
export const __test = { verifyPrivyToken, signSession, readSession, balancesFor, contractsFrom, padAddress };
