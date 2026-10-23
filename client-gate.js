/**
 * CHOG TRIALS — client gate
 * Drop this in the page. It owns login, the session, and re-checking.
 *
 * It never touches the app secret and never decides on its own whether you
 * are a holder: it asks the Worker, which asks the chain.
 *
 *   window.ChogGate.state   { ready, authenticated, holder, wallet, count, exp, error }
 *   window.ChogGate.ensure()  -> Promise<boolean>   (logs in if needed)
 *   window.ChogGate.refresh() -> Promise<boolean>   (re-check chain now)
 *   window.ChogGate.logout()
 *   window.addEventListener('chog-gate', e => ...)  // state changed
 *
 * Config, set before this script loads:
 *   window.CHOG_GATE_CONFIG = { privyAppId: 'cl_...', loginMethods: ['wallet'] };
 */
(function () {
  const CFG = Object.assign(
    { privyAppId: '', loginMethods: null, recheckMs: 0 },
    window.CHOG_GATE_CONFIG || {}
  );

  const state = {
    ready: false, authenticated: false, holder: false,
    wallet: null, count: 0, exp: 0, error: null,
  };

  const emit = () => window.dispatchEvent(new CustomEvent('chog-gate', { detail: { ...state } }));
  const set = (patch) => { Object.assign(state, patch); emit(); };

  /* ---- server calls -------------------------------------------------- */
  async function postSession(token) {
    const r = await fetch('/api/gate/session', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      credentials: 'same-origin',
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok) {
      set({ holder: true, wallet: body.wallet, count: body.count, exp: body.exp, error: null });
      return true;
    }
    set({ holder: false, wallet: null, count: 0, exp: 0, error: body.reason || ('http_' + r.status) });
    return false;
  }

  async function status() {
    try {
      const r = await fetch('/api/gate/status', { credentials: 'same-origin' });
      const b = await r.json();
      if (b.ok) { set({ holder: true, wallet: b.wallet, count: b.count, exp: b.exp, error: null }); return true; }
      set({ holder: false });
      return false;
    } catch { set({ holder: false, error: 'offline' }); return false; }
  }

  async function refresh() {
    if (!state.authenticated) return status();
    try {
      const r = await fetch('/api/gate/refresh', { method: 'POST', credentials: 'same-origin' });
      const b = await r.json();
      if (b.ok) { set({ holder: true, wallet: b.wallet, count: b.count, exp: b.exp, error: null }); return true; }
      set({ holder: false, error: b.reason || null });
      return false;
    } catch { return state.holder; }
  }

  /* ---- privy (React island, kept out of the game's scope) ------------- */
  let privy = null;          // { login, logout, getAccessToken, authenticated }
  let loginWaiters = [];

  function mountPrivy() {
    return import('https://esm.sh/react@18.3.1').then((ReactMod) =>
      import('https://esm.sh/react-dom@18.3.1/client').then((DomMod) =>
        import('https://esm.sh/@privy-io/react-auth@2.25.0?deps=react@18.3.1,react-dom@18.3.1')
          .then((PrivyMod) => {
            const React = ReactMod.default;
            const { createRoot } = DomMod;
            const { PrivyProvider, usePrivy } = PrivyMod;

            function Bridge() {
              const p = usePrivy();
              React.useEffect(() => {
                privy = {
                  login: () => p.login(),
                  logout: () => p.logout(),
                  linkWallet: () => p.linkWallet(),
                  authenticated: p.authenticated,
                  getAccessToken: () => p.getAccessToken(),
                };
                set({ ready: p.ready, authenticated: p.authenticated });
                if (p.authenticated) {
                  p.getAccessToken()
                    .then((t) => postSession(t))
                    .finally(() => { loginWaiters.forEach((w) => w()); loginWaiters = []; });
                } else {
                  loginWaiters.forEach((w) => w()); loginWaiters = [];
                }
              }, [p.ready, p.authenticated]);
              return null;
            }

            const host = document.createElement('div');
            host.id = 'privy-root';
            host.style.display = 'none';
            document.body.appendChild(host);

            createRoot(host).render(
              React.createElement(PrivyProvider, {
                appId: CFG.privyAppId,
                config: Object.assign(
                  /* no loginMethods key = whatever the Privy dashboard has enabled:
                     email, wallet, google, twitter... the dashboard owns that list */
                  CFG.loginMethods ? { loginMethods: CFG.loginMethods } : {},
                  {
                    appearance: { theme: 'dark', accentColor: '#A56BFF' },
                    embeddedWallets: { createOnLogin: 'off' },
                  }
                ),
              }, React.createElement(Bridge))
            );
          })
      )
    );
  }

  async function ensure() {
    /* Every entry re-reads the chain. This is what makes "sold it last week"
       behave correctly: the cookie is irrelevant, the balance decides. */
    if (state.authenticated) {
      const fresh = await refresh();
      if (fresh) return true;
      if (state.error && state.error !== 'not_a_holder') return false;
      if (state.error === 'not_a_holder') return false;
    }
    if (!state.ready) {
      await new Promise((res) => {
        const t = setInterval(() => { if (state.ready || state.error) { clearInterval(t); res(); } }, 100);
        setTimeout(() => { clearInterval(t); res(); }, 8000);
      });
    }
    if (state.error === 'sdk_failed') return false;

    if (!state.authenticated) {
      const done = new Promise((res) => loginWaiters.push(res));
      try { privy.login(); } catch { return false; }
      await done;
    }
    if (state.holder) return true;
    try {
      const token = await privy.getAccessToken();
      return await postSession(token);
    } catch { set({ error: 'login_failed' }); return false; }
  }

  function logout() {
    try { privy.logout(); } catch {}
    set({ authenticated: false, holder: false, wallet: null, count: 0, exp: 0 });
  }

  /* for the email-login case: attach the wallet that actually holds the Chog */
  async function linkWallet() {
    if (!privy || !privy.linkWallet) return false;
    try { privy.linkWallet(); } catch { return false; }
    return true;
  }

  window.ChogGate = { state, ensure, refresh, logout, linkWallet, status };

  /* ---- boot ---------------------------------------------------------- */
  if (!CFG.privyAppId) {
    set({ ready: true, error: 'no_app_id' });
    return;
  }
  status().then(() => {
    mountPrivy()
      .then(() => set({ ready: true }))
      .catch(() => set({ ready: true, error: 'sdk_failed' }));
  });

  /* Deliberately no timer and no mid-run polling: once a run has started the
     player finishes it. The gate re-reads the chain on the next entry. */
})();
