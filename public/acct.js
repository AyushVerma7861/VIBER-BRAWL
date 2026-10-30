/* CHOG TRIALS — account layer (mock build)
 *
 * Everyone gets an account the first time they open the game: a name, an id,
 * and a place on the board. Adding an email later upgrades the SAME row - it
 * never creates a second identity. Guests are first-class.
 *
 * The four methods are shaped for a server. Swap the bodies for fetch() and
 * nothing above changes.
 *
 *   Acct.get()                  -> {id, name, email, createdAt}
 *   Acct.ensure()               -> Promise<account>   (shows first-run if none)
 *   Acct.linkEmail(email)       -> {ok, pending:true} (mock: no mail is sent)
 *   Acct.confirmEmail(code)     -> {ok}
 */
(function () {
  var KEY = 'ct.acct.v1';
  var TMP = 'ct.acct.tmp.v1';

  function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var acct = read(KEY, null);

  function save() { write(KEY, acct); }

  function newId() {
    var a = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
    for (var i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)];
    return 'p_' + s;
  }

  function suggest() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', s = '';
    for (var i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
    return s + Math.floor(10 + Math.random() * 89);
  }

  var CSS = ''
    + '.acwrap{position:fixed;inset:0;z-index:8600;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(4,3,9,.92);backdrop-filter:blur(10px);padding:16px}'
    + '.acwrap.on{display:flex}'
    + '.acard{width:min(430px,94vw);background:#0A0812;border:1px solid rgba(255,255,255,.13);'
    + 'border-radius:18px;padding:26px 24px 22px;box-shadow:0 40px 120px rgba(0,0,0,.8)}'
    + '.ackick{font:600 9.5px/1 ui-monospace,monospace;letter-spacing:.24em;color:#5CFFE7;margin-bottom:12px}'
    + '.actitle{font:700 22px/1.25 system-ui,sans-serif;color:#EDE9F5;margin:0 0 8px;letter-spacing:-.01em}'
    + '.acsub{font:400 13px/1.6 system-ui,sans-serif;color:#8B84A8;margin:0 0 18px}'
    + '.acinput{width:100%;box-sizing:border-box;background:#12101C;border:1.5px solid rgba(255,255,255,.14);'
    + 'border-radius:11px;padding:14px 14px;font:700 16px/1 ui-monospace,monospace;color:#EDE9F5;'
    + 'letter-spacing:.1em;text-transform:uppercase;outline:none}'
    + '.acinput:focus{border-color:rgba(92,255,231,.55)}'
    + '.acinput::placeholder{color:#4A4560}'
    + '.achint{font:400 11.5px/1.5 system-ui,sans-serif;color:#5F5E5A;margin:8px 0 0}'
    + '.acbtn{width:100%;margin-top:16px;border:0;border-radius:11px;padding:14px;cursor:pointer;'
    + 'font:700 13px/1 system-ui,sans-serif;letter-spacing:.1em;background:#5CFFE7;color:#04120F}'
    + '.acbtn:disabled{background:#1E1B2C;color:#4A4560;cursor:not-allowed}'
    + '.acskip{width:100%;margin-top:9px;border:0;background:none;color:#5F5E5A;'
    + 'font:500 12px/1 system-ui,sans-serif;cursor:pointer;padding:8px}'
    + '.acchip{position:fixed;top:14px;left:14px;z-index:800;display:flex;align-items:center;gap:8px;'
    + 'background:#0B1220;border:1.5px solid rgba(255,255,255,.16);border-radius:999px;'
    + 'padding:7px 13px 7px 10px;font:600 11px/1 ui-monospace,monospace;color:#CFF9EF;'
    + 'cursor:pointer;letter-spacing:.05em}'
    + '.acchip .av{width:22px;height:22px;border-radius:50%;background:rgba(92,255,231,.14);'+ 'border:1px solid rgba(92,255,231,.45);display:grid;place-items:center;'+ 'font:700 10px/1 ui-monospace,monospace;color:#5CFFE7;letter-spacing:0}'
    + '.acchip .st{color:#5F5E5A;font-size:9px}'
    + '.acsheet{position:fixed;top:52px;left:14px;z-index:801;display:none;width:236px;background:#131A2C;'
    + 'border:1.5px solid rgba(255,255,255,.16);border-radius:14px;padding:8px;'
    + 'box-shadow:0 18px 44px rgba(0,0,0,.6)}'
    + '.acsheet.on{display:block}'
    + '.acsheet .row{display:flex;justify-content:space-between;padding:8px 9px;'
    + 'font:600 10.5px/1 ui-monospace,monospace;color:#8B84A8}'
    + '.acsheet .row span:last-child{color:#EDE9F5}'
    + '.acsheet button{display:block;width:100%;text-align:left;border:0;border-radius:9px;padding:10px 11px;'
    + 'margin-top:4px;font:700 11.5px/1 system-ui,sans-serif;background:rgba(255,255,255,.06);'
    + 'color:#EDE9F5;cursor:pointer}'
    + '.acsheet button:hover{background:rgba(255,255,255,.12)}';
    + '.acchip{top:16px;left:16px;gap:8px;background:rgba(8,7,14,.78);border:1px solid rgba(255,255,255,.20);border-radius:5px;padding:6px 11px 6px 8px;font:600 10px/1 ui-monospace,monospace;color:rgba(242,234,255,.86);letter-spacing:.18em;text-transform:uppercase;backdrop-filter:blur(4px);transition:border-color .2s,background .2s}'
    + '.acchip:hover{border-color:rgba(255,255,255,.4);background:rgba(8,7,14,.8)}'
    + '.acchip .av{width:17px;height:17px;background:none;border:1px solid rgba(242,234,255,.42);font:700 8.5px/1 ui-monospace,monospace;color:rgba(242,234,255,.9);letter-spacing:0}'
    + '.acchip .st{color:rgba(242,234,255,.38);font-size:10px;letter-spacing:.16em}'

  /* chip dressed in the trials UI's language: square, uppercase, hairline */
  CSS += '.acchip{position:fixed;top:18px;left:18px;z-index:800;display:flex;align-items:center;gap:12px;'
    + 'background:rgba(8,7,14,.62);border:1px solid rgba(255,255,255,.26);border-radius:9px;'
    + 'padding:9px 18px 9px 9px;font:600 13.5px/1 ui-monospace,monospace;color:#F2EAFF;'
    + 'cursor:pointer;letter-spacing:.14em;text-transform:uppercase;backdrop-filter:blur(6px);'
    + 'transition:border-color .2s,background .2s}'
    + '.acchip:hover{border-color:rgba(255,255,255,.42);background:rgba(8,7,14,.82)}'
    + '.acchip .av{width:42px;height:42px;border-radius:10px;background:none;'
    + 'border:1px solid rgba(255,255,255,.28);display:grid;place-items:center;object-fit:cover;object-position:50% 28%;'
    + 'font:700 15px/1 ui-monospace,monospace;color:rgba(242,234,255,.9);letter-spacing:0}'
    + '.acchip .st{color:rgba(242,234,255,.32);font-size:8.5px;letter-spacing:.14em}';

  CSS += '.acchip{transition:opacity .28s ease,transform .28s ease,border-color .2s,background .2s}'
    + '.acchip .av{transition:border-color .2s,color .2s}'
    + '.acchip:hover .av{border-color:rgba(92,255,231,.7);color:#5CFFE7}'
    + '.acchip .pen{opacity:0;transition:opacity .2s;margin-left:2px;font-size:11px;color:rgba(242,234,255,.5)}'
    + '.acchip:hover .pen{opacity:1}';

  CSS += '.acchip .av{object-fit:cover;border-radius:50%}'
    + '.acchip .tid{font:700 12px/1 ui-monospace,monospace;color:#FFD36A;letter-spacing:.04em}'
    + '.acsheet button.av{background:rgba(255,211,106,.14);color:#FFD36A}';

  function style() {
    if (document.getElementById('acStyle')) return;
    var s = document.createElement('style');
    s.id = 'acStyle'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function modal(html) {
    var w = document.createElement('div');
    w.className = 'acwrap on';
    w.innerHTML = '<div class="acard">' + html + '</div>';
    document.body.appendChild(w);
    return w;
  }

  /* the server is the source of truth for identity; it sets the cookie */
  function syncPlayer(name) {
    try {
      return fetch('/api/player', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      }).then(function (r) { return r.json(); }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /* ---------------------------------------------------------- first run */
  function firstRun() {
    return new Promise(function (resolve) {
      var w = modal(
        '<div class="ackick">WELCOME TO THE TRIALS</div>'
        + '<h1 class="actitle">What should we call you?</h1>'
        + '<p class="acsub">This name goes on the leaderboard and carries your progress. You can add an email later to keep it safe.</p>'
        + '<input class="acinput" id="acName" maxlength="12" autocomplete="off" spellcheck="false">'
        + '<p class="achint">12 characters. Letters and numbers.</p>'
        + '<button class="acbtn" id="acGo">ENTER THE STORE</button>'
        + '<button class="acskip" id="acRand">Pick one for me</button>'
      );
      var input = w.querySelector('#acName'), go = w.querySelector('#acGo');
      input.value = suggest();
      input.select();
      setTimeout(function () { input.focus(); }, 60);

      function valid() { return /^[A-Za-z0-9 _-]{1,12}$/.test(input.value.trim()); }
      function sync() { go.disabled = !valid(); }
      input.addEventListener('input', sync);
      sync();

      function commit(name) {
        acct = { id: newId(), name: name, email: null, createdAt: Date.now() };
        save();
        syncPlayer(name);
        w.remove();
        resolve(acct);
      }
      go.addEventListener('click', function () { if (valid()) commit(input.value.trim().toUpperCase()); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && valid()) commit(input.value.trim().toUpperCase()); });
      w.querySelector('#acRand').addEventListener('click', function () { commit(suggest()); });
    });
  }

  /* ------------------------------------------------------------- email */
  function emailFlow() {
    return new Promise(function (resolve) {
      var w = modal(
        '<div class="ackick">KEEP YOUR PROGRESS</div>'
        + '<h1 class="actitle">Add an email</h1>'
        + '<p class="acsub">Your name and times stay on this device until you do. An email lets you continue on another one.</p>'
        + '<input class="acinput" id="acMail" type="email" placeholder="you@example.com" autocomplete="email" spellcheck="false" style="text-transform:none;letter-spacing:.02em">'
        + '<p class="achint">We send a 6-digit code. No password, ever.</p>'
        + '<button class="acbtn" id="acSend">SEND CODE</button>'
        + '<button class="acskip" id="acLater">Not now</button>'
      );
      var mail = w.querySelector('#acMail'), send = w.querySelector('#acSend');
      function ok() { return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail.value.trim()); }
      mail.addEventListener('input', function () { send.disabled = !ok(); });
      send.disabled = true;
      w.querySelector('#acLater').addEventListener('click', function () { w.remove(); resolve({ ok: false }); });

      send.addEventListener('click', function () {
        var addr = mail.value.trim();
        w.remove();
        /* mock: no mail is sent. A real build posts to /api/auth/email/start */
        var c = modal(
          '<div class="ackick">CHECK YOUR INBOX</div>'
          + '<h1 class="actitle">Enter the code</h1>'
          + '<p class="acsub">Sent to <b style="color:#EDE9F5">' + addr.replace(/[<>&]/g, '') + '</b>. In this preview no email is actually sent — type any 6 digits.</p>'
          + '<input class="acinput" id="acCode" maxlength="6" placeholder="000000" style="letter-spacing:.3em;text-align:center">'
          + '<button class="acbtn" id="acDone">VERIFY</button>'
        );
        var code = c.querySelector('#acCode'), done = c.querySelector('#acDone');
        code.focus();
        code.addEventListener('input', function () { done.disabled = code.value.length !== 6; });
        done.disabled = true;
        done.addEventListener('click', function () {
          acct.email = addr; acct.emailVerified = Date.now(); save();
          c.remove(); paintChip();
          resolve({ ok: true });
        });
      });
    });
  }

  /* -------------------------------------------------------------- chip */
  var chip = null, sheet = null;

  function paintChip() {
    if (!chip || !acct) return;
    var face = acct.avatarId
      ? '<img class="av" src="/avatars/' + acct.avatarId + '.webp" alt="" '
        + 'onerror="this.outerHTML=\'<span class=\\\'av\\\'>' + acct.name.charAt(0) + '</span>\'">'
      : '<span class="av">' + acct.name.charAt(0) + '</span>';
    var idTag = acct.avatarId ? '<span class="tid">#' + String(acct.avatarId).padStart(4, '0') + '</span>' : '';
    chip.innerHTML = face + '<span>' + acct.name + '</span>' + idTag
      + '<span class="st">' + (acct.email ? 'saved' : 'guest') + '</span>'
      + '<span class="pen">&#9998;</span>';
    if (sheet) {
      sheet.querySelector('#acWho').textContent = acct.name;
      sheet.querySelector('#acMailRow').textContent = acct.email || '—';
      sheet.querySelector('#acLink').textContent = acct.email ? 'Change email' : 'Add email';
    }
  }

  function mountChip() {
    style();
    chip = document.createElement('div');
    chip.className = 'acchip';
    chip.id = 'acChip';
    document.body.appendChild(chip);

    sheet = document.createElement('div');
    sheet.className = 'acsheet';
    sheet.innerHTML = '<div class="row"><span>PLAYING AS</span><span id="acWho">—</span></div>'
      + '<div class="row"><span>EMAIL</span><span id="acMailRow">—</span></div>'
      + '<button id="acAvatar" class="av">Choose avatar</button>'
      + '<button id="acLink">Add email</button>'
      + '<button id="acBoard">Leaderboard</button>';
    document.body.appendChild(sheet);

    paintChip();
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      if (window.__acctChipEdit) { editName().then(paintChip); return; }
      sheet.classList.toggle('on');
      paintChip();
    });
    document.addEventListener('click', function () { sheet.classList.remove('on'); });
    sheet.addEventListener('click', function (e) { e.stopPropagation(); });
    sheet.querySelector('#acAvatar').addEventListener('click', function () {
      sheet.classList.remove('on');
      if (window.Avatar) window.Avatar.open();
    });
    sheet.querySelector('#acLink').addEventListener('click', function () {
      sheet.classList.remove('on');
      emailFlow();
    });
    sheet.querySelector('#acBoard').addEventListener('click', function () {
      sheet.classList.remove('on');
      if (window.LB) window.LB.open();
    });
  }

  function editName() {
    return new Promise(function (resolve) {
      var w = modal(
        '<div class="ackick">YOUR NAME</div>'
        + '<h1 class="actitle">Change it</h1>'
        + '<p class="acsub">This is what the board shows. Your times and progress stay exactly as they are.</p>'
        + '<input class="acinput" id="acEdit" maxlength="12" autocomplete="off" spellcheck="false">'
        + '<p class="achint">12 characters. Letters and numbers.</p>'
        + '<button class="acbtn" id="acSave">SAVE</button>'
        + '<button class="acskip" id="acCancel">Cancel</button>'
      );
      var i2 = w.querySelector('#acEdit'), sv = w.querySelector('#acSave');
      i2.value = acct ? acct.name : '';
      setTimeout(function(){ i2.focus(); i2.select(); }, 60);
      function valid2(){ return /^[A-Za-z0-9 _-]{1,12}$/.test(i2.value.trim()); }
      function sync2(){ sv.disabled = !valid2(); }
      i2.addEventListener('input', sync2); sync2();
      w.querySelector('#acCancel').addEventListener('click', function(){ w.remove(); resolve(null); });
      sv.addEventListener('click', function(){
        if(!valid2()) return;
        acct.name = i2.value.trim().toUpperCase(); save();
        syncPlayer(acct.name);
        w.remove(); paintChip(); resolve(acct);
      });
    });
  }

  window.Acct = {
    get: function () { return acct; },
    ensure: function (opts) {
      style();
      var wantChip = !opts || opts.chip !== false;

      /* the server decides who you are: the wallet owns the account, so the
         same wallet on any device gets the same name. localStorage is only a
         paint cache now, never the truth. */
      return fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (me) {
          if (me && me.ok && me.name) {
            acct = { id: null, name: me.name, email: (acct && acct.email) || null,
                     avatarId: me.token_id || null, createdAt: (acct && acct.createdAt) || Date.now() };
            save();
            if (wantChip && !chip) mountChip();
            return acct;
          }
          if (me && me.ok && !me.name) {
            /* wallet known, no account yet - ask for a name */
            return firstRun().then(function (a) {
              if (wantChip) mountChip();
              if (window.Avatar && window.Avatar.prefetch) {
                window.Avatar.prefetch().then(function (d) {
                  if (d && d.ok && d.tokens && d.tokens.length && !a.avatarId) window.Avatar.open();
                }).catch(function () {});
              }
              return a;
            });
          }
          /* no wallet (judge pass): keep the old local behaviour */
          if (acct && acct.name) { if (wantChip && !chip) mountChip(); return acct; }
          return firstRun().then(function (a) { if (wantChip) mountChip(); return a; });
        })
        .catch(function () {
          if (acct && acct.name) { if (wantChip && !chip) mountChip(); return acct; }
          return firstRun().then(function (a) { if (wantChip) mountChip(); return a; });
        });
    },
    editName: editName,
    setAvatar: function (id) { if (!acct) return; acct.avatarId = id; save(); paintChip(); },
    linkEmail: emailFlow,
    paintChip: paintChip
  };
})();
