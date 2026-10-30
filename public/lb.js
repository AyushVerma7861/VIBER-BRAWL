/* CHOG TRIALS — leaderboard, reading the real board.
 *
 * Five rows, not twenty: a short board reads as "just started" rather than
 * "nobody plays this". Your own rank is always shown, even if you are #40.
 */
(function () {
  function fmt(ms) {
    var s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  var CSS = ''
    + '.lbwrap{position:fixed;inset:0;z-index:8500;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(3,2,7,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:18px}'
    + '.lbwrap.on{display:flex}'
    + '.lbp{width:min(780px,92vw);max-height:90vh;max-height:90dvh;display:flex;flex-direction:column;'
    + 'background:#0A0812;border:1px solid rgba(255,255,255,.10);border-radius:16px;overflow:hidden;'
    + 'box-shadow:0 40px 110px rgba(0,0,0,.8)}'
    + '.lbh{display:flex;align-items:flex-start;justify-content:space-between;padding:26px 28px 18px}'
    + '.lbk{font:700 9.5px/1 ui-monospace,monospace;letter-spacing:.24em;color:#5CFFE7;margin-bottom:9px}'
    + '.lbt{font:700 32px/1 system-ui,sans-serif;letter-spacing:-.01em;color:#F2EAFF;margin:0}'
    + '.lbx{width:34px;height:34px;flex:0 0 34px;border-radius:50%;border:1px solid rgba(255,255,255,.14);'
    + 'background:none;color:#8B84A8;font-size:16px;cursor:pointer;display:grid;place-items:center}'
    + '.lbx:hover{background:rgba(255,255,255,.08);color:#F2EAFF}'
    + '.lbcols{display:flex;padding:0 24px 8px;font:700 8.5px/1 ui-monospace,monospace;letter-spacing:.2em;'
    + 'color:#3F3956}'
    + '.lbcols span:first-child{width:58px}'
    + '.lbcols span:nth-child(2){flex:1}'
    + '.lblist{padding:0 16px 6px}'
    + '.lbr{display:flex;align-items:center;padding:0 14px;border-radius:10px;'
    + 'border-bottom:1px solid rgba(255,255,255,.045);height:68px}'
    + '.lbr .rk{width:60px;font:700 14px/1 ui-monospace,monospace;color:#5A5470;'
    + 'font-variant-numeric:tabular-nums}'
    + '.lbr .nm{flex:1;font:600 16.5px/1 ui-monospace,monospace;color:#C9C1E0;letter-spacing:.04em;'
    + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px}'
    + '.lbr .tm{font:700 17px/1 ui-monospace,monospace;color:#9FE1CB;font-variant-numeric:tabular-nums}'
    + '.lbr.p1,.lbr.p2,.lbr.p3{height:96px;border-bottom:0;margin-bottom:2px;position:relative}'
    + '.lbr.p1:before,.lbr.p2:before,.lbr.p3:before{content:"";position:absolute;left:0;top:10px;bottom:10px;'
    + 'width:3px;border-radius:2px}'
    + '.lbr.p1:before{background:#FFD36A}'
    + '.lbr.p2:before{background:#C9C1E0}'
    + '.lbr.p3:before{background:#CD7F32}'
    + '.lbr.p1 .rk,.lbr.p2 .rk,.lbr.p3 .rk{font-size:28px;width:64px}'
    + '.lbr.p1 .rk{color:#FFD36A}.lbr.p2 .rk{color:#E2E8F0}.lbr.p3 .rk{color:#CD7F32}'
    + '.lbr.p1 .nm{font-size:20px;color:#FFF8E7}'
    + '.lbr.p2 .nm,.lbr.p3 .nm{font-size:18px;color:#EDE9F5}'
    + '.lbr.p1 .tm{font-size:24px;color:#FFD36A}'
    + '.lbr.p2 .tm,.lbr.p3 .tm{font-size:20px;color:#DCE3EC}'
    + '.lbmine{margin:8px 16px 16px;padding:14px 16px;border-radius:10px;background:rgba(255,255,255,.04);'
    + 'border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:14px}'
    + '.lbmine .k{font:700 9px/1 ui-monospace,monospace;letter-spacing:.22em;color:#8B84A8}'
    + '.lbmine .r{font:700 12px/1 ui-monospace,monospace;color:#5CFFE7}'
    + '.lbmine .v{margin-left:auto;font:700 15px/1 ui-monospace,monospace;color:#F2EAFF;'
    + 'font-variant-numeric:tabular-nums}'
    + '.lbempty{padding:30px 0 34px;text-align:center;font:600 11px/1.8 ui-monospace,monospace;'
    + 'letter-spacing:.14em;color:#3F3956}'
    + '.lbempty b{display:block;color:#5CFFE7;margin-bottom:6px;font-size:12px}';

  CSS += '.lbr .face{width:52px;height:52px;border-radius:10px;object-fit:cover;object-position:50% 28%;'
    + 'flex:0 0 52px;margin-right:16px;border:1px solid rgba(255,255,255,.14);display:block}'
    + '.lbr.p1 .face{width:68px;height:68px;flex:0 0 68px;border-radius:13px;'
    + 'border:1.5px solid rgba(255,211,106,.6)}'
    + '.lbr .face.letter{display:grid;place-items:center;background:rgba(255,255,255,.06);'
    + 'font:700 12px/1 ui-monospace,monospace;color:#8B84A8}'
    + '.lbr.p1 .face.letter{color:#FFD36A;font-size:14px}'
    + '.lbr .tid{color:#8B84A8;font-size:11.5px;margin-left:7px;letter-spacing:.02em}'
    + '.lbr.p1 .tid{color:#FFD36A}';

  function style() {
    if (document.getElementById('lbStyle')) return;
    var s = document.createElement('style');
    s.id = 'lbStyle'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function rowsHtml(rows) {
    if (!rows.length) {
      return '<div class="lbempty"><b>NO CLEARS YET</b>BE THE FIRST NAME HERE</div>';
    }
    return rows.map(function (r, k) {
      var place = k + 1;
      var cls = 'lbr' + (place <= 3 ? ' p' + place : '');
      var face = r.token_id
        ? '<img class="face" src="/avatars/' + r.token_id + '.webp" alt="" loading="lazy"'
          + ' onerror="this.outerHTML=\'<span class=&quot;face letter&quot;>' + esc(String(r.name).charAt(0)) + '</span>\'">'
        : '<span class="face letter">' + esc(String(r.name).charAt(0)) + '</span>';
      var idTag = r.token_id ? '<span class="tid">#' + String(r.token_id).padStart(4, '0') + '</span>' : '';
      return '<div class="' + cls + '">'
        + '<span class="rk">' + pad(place) + '</span>'
        + face
        + '<span class="nm">' + esc(r.name) + idTag + '</span>'
        + '<span class="tm">' + fmt(r.ms) + '</span></div>';
    }).join('');
  }

  var host = null, panel = null;

  function build() {
    style();
    host = document.createElement('div');
    host.className = 'lbwrap';
    host.id = 'lbWrap';
    panel = document.createElement('div');
    panel.className = 'lbp';
    host.appendChild(panel);
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    document.body.appendChild(host);
  }

  function shell(inner) {
    return '<div class="lbh">'
      + '<div><div class="lbk">CHOG TRIALS</div><h2 class="lbt">Leaderboard</h2></div>'
      + '<button class="lbx" aria-label="Close">&times;</button></div>'
      + '<div class="lbcols"><span>RANK</span><span>PLAYER</span><span>TIME</span></div>'
      + inner;
  }

  function paint(data) {
    var you = data && data.you;
    var mine = '<div class="lbmine"><span class="k">YOUR BEST</span>'
      + (you ? '<span class="r">#' + pad(you.rank) + '</span><span class="v">' + fmt(you.ms) + '</span>'
             : '<span class="v" style="color:#3F3956">— not set —</span>')
      + '</div>';
    panel.innerHTML = shell('<div class="lblist">' + rowsHtml((data && data.rows) || []) + '</div>' + mine);
    panel.querySelector('.lbx').addEventListener('click', close);
  }

  function open() {
    if (!host) build();
    panel.innerHTML = shell('<div class="lblist"><div class="lbempty">LOADING</div></div>');
    panel.querySelector('.lbx').addEventListener('click', close);
    host.classList.add('on');

    fetch('/api/leaderboard', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { paint(d && d.ok ? d : { rows: [] }); })
      .catch(function () { paint({ rows: [] }); });
  }

  function close() { if (host) host.classList.remove('on'); }

  window.LB = {
    open: open,
    close: close,
    fmt: fmt,
    refresh: function () { if (host && host.classList.contains('on')) open(); }
  };

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
