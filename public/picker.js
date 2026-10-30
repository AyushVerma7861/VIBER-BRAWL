/* CHOG TRIALS — avatar picker.
 *
 * Shows the Chogs the signed-in wallet actually holds, lets the player pick
 * one, and saves it. The server re-checks ownership on save, so the client
 * cannot claim a token it does not own.
 */
(function () {
  var CSS = ''
    + '.avwrap{position:fixed;inset:0;z-index:8700;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(3,2,7,.9);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:18px}'
    + '.avwrap.on{display:flex}'
    + '.avp{width:min(560px,94vw);max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;'
    + 'background:#0A0812;border:1px solid rgba(255,255,255,.10);border-radius:16px;overflow:hidden;'
    + 'box-shadow:0 40px 110px rgba(0,0,0,.8)}'
    + '.avh{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px 14px}'
    + '.avk{font:700 9.5px/1 ui-monospace,monospace;letter-spacing:.24em;color:#5CFFE7;margin-bottom:8px}'
    + '.avt{font:700 22px/1.1 system-ui,sans-serif;color:#F2EAFF;margin:0}'
    + '.avx{width:34px;height:34px;flex:0 0 34px;border-radius:50%;border:1px solid rgba(255,255,255,.14);'
    + 'background:none;color:#8B84A8;font-size:16px;cursor:pointer;display:grid;place-items:center}'
    + '.avx:hover{background:rgba(255,255,255,.08);color:#F2EAFF}'
    + '.avg{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:10px;'
    + 'padding:4px 22px 22px;overflow:auto}'
    + '.avtile{position:relative;border:1.5px solid rgba(255,255,255,.10);border-radius:12px;overflow:hidden;'
    + 'background:#12101C;cursor:pointer;transition:border-color .18s,transform .18s;aspect-ratio:1}'
    + '.avtile:hover{border-color:rgba(92,255,231,.5);transform:translateY(-2px)}'
    + '.avtile.sel{border-color:#FFD36A;box-shadow:0 0 0 1px rgba(255,211,106,.4)}'
    + '.avtile img{width:100%;height:100%;object-fit:contain;display:block}'
    + '.avtile .id{position:absolute;left:0;right:0;bottom:0;padding:16px 8px 6px;'
    + 'font:700 10px/1 ui-monospace,monospace;letter-spacing:.08em;color:#F2EAFF;'
    + 'background:linear-gradient(to top,rgba(3,2,7,.92),transparent)}'
    + '.avtile .ph{width:100%;height:100%;display:grid;place-items:center;'
    + 'font:700 26px/1 ui-monospace,monospace;color:#332E45}'
    + '.avtile .pick{position:absolute;top:7px;right:7px;width:18px;height:18px;border-radius:50%;'
    + 'background:#FFD36A;display:none;place-items:center;font:700 11px/1 system-ui;color:#1A1A16}'
    + '.avtile.sel .pick{display:grid}'
    + '.avmsg{padding:30px 24px 34px;text-align:center;font:600 11.5px/1.8 ui-monospace,monospace;'
    + 'letter-spacing:.1em;color:#4A4560}'
    + '.avmsg b{display:block;color:#5CFFE7;font-size:12px;margin-bottom:6px}';

  function style() {
    if (document.getElementById('avStyle')) return;
    var s = document.createElement('style');
    s.id = 'avStyle'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var host = null, panel = null, tokens = [], selected = null;

  function build() {
    style();
    host = document.createElement('div');
    host.className = 'avwrap';
    panel = document.createElement('div');
    panel.className = 'avp';
    host.appendChild(panel);
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    document.body.appendChild(host);
  }

  function shell(inner) {
    return '<div class="avh"><div><div class="avk">YOUR COLLECTION</div>'
      + '<h2 class="avt">Choose your Chog</h2></div>'
      + '<button class="avx" aria-label="Close">&times;</button></div>' + inner;
  }

  function paintGrid() {
    var grid = tokens.map(function (id) {
      var sel = selected === id ? ' sel' : '';
      return '<div class="avtile' + sel + '" data-id="' + id + '">'
        + '<img src="/avatars/' + id + '.webp" alt="Chog ' + id + '" loading="lazy"'
        + ' onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.ph\').style.display=\'grid\'">'
        + '<div class="ph" style="display:none">' + String(id).slice(0, 3) + '</div>'
        + '<div class="pick">&#10003;</div>'
        + '<div class="id">#' + String(id).padStart(4, '0') + '</div></div>';
    }).join('');
    panel.innerHTML = shell('<div class="avg">' + grid + '</div>');
    panel.querySelector('.avx').addEventListener('click', close);
    Array.prototype.forEach.call(panel.querySelectorAll('.avtile'), function (el) {
      el.addEventListener('click', function () { choose(Number(el.getAttribute('data-id'))); });
    });
  }

  function choose(id) {
    selected = id;
    paintGrid();
    fetch('/api/player/avatar', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: id })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) {
        if (window.Acct && window.Acct.setAvatar) window.Acct.setAvatar(id);
        setTimeout(close, 320);
      }
    }).catch(function () {});
  }

  function message(title, body) {
    panel.innerHTML = shell('<div class="avmsg"><b>' + title + '</b>' + body + '</div>');
    panel.querySelector('.avx').addEventListener('click', close);
  }

  function open() {
    if (!host) build();
    panel.innerHTML = shell('<div class="avmsg">LOADING</div>');
    panel.querySelector('.avx').addEventListener('click', close);
    host.classList.add('on');

    fetch('/api/my-tokens', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) {
          if (d && d.reason === 'no_wallet') {
            message('NO WALLET ON THIS SESSION',
              'The Chog avatar comes from the wallet you signed in with. A judge pass has no wallet, so there is nothing to read.');
          } else {
            message('COULD NOT READ YOUR WALLET', 'The chain did not answer. Try again in a moment.');
          }
          return;
        }
        tokens = d.tokens || [];
        if (!tokens.length) {
          message('NO CHOGS IN THIS WALLET', 'The board still works — you keep your name and your time.');
          return;
        }
        paintGrid();
      })
      .catch(function () { message('COULD NOT REACH THE SERVER', 'Try again in a moment.'); });
  }

  function close() { if (host) host.classList.remove('on'); }

  window.Avatar = { open: open, close: close };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
