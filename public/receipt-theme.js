/* Halloween receipt theme — presentation only.
   Restyles the result receipt and swaps three strings. No game logic. */
(() => {
  'use strict';

  const css = `
    #receiptWrap{ background:rgba(6,3,1,.82); }
    .rcPaper{ background:#191009; color:#F6E7CE;
      box-shadow:0 30px 70px rgba(0,0,0,.8), inset 0 0 0 1px rgba(226,87,31,.34); }
    .rcPaper::after{ background:repeating-linear-gradient(-45deg,#191009 0 7px,transparent 7px 14px); }
    .rcHead{ color:#F6E7CE; display:flex; align-items:center; justify-content:center; gap:6px; }
    .rcHead svg{ display:block; }
    .rcSub{ color:#B98150; }
    .rcHero span{ color:#E2571F; }
    .rcHero b{ color:#FFD9A8; }
    .rcId i{ color:#B98150; }
    .rcRow{ border-top-color:#3A2416; }
    .rcRow.first{ border-top-color:#5A3A22; }
    .rcStamp{ color:#E2571F; }
    .rcStamp.fail{ color:#F09595; }
    #rcShare{ background:#E2571F; color:#200A03; }
    #rcSave{ background:#F6E7CE; color:#191009; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  const PUMPKIN = `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.2c.5 0 .9.3 1.1.7 1.9-.5 3.6.6 3.9 2.4.3 1.9-1 3.6-2.6 4.2
             .3.5.4 1.1.2 1.6-.2.6-.7 1-1.3 1.1-.4.1-.9 0-1.3-.3-.4.3-.9.4-1.3.3
             -.6-.1-1.1-.5-1.3-1.1-.2-.5-.1-1.1.2-1.6C4.5 8.9 3.2 7.2 3.5 5.3c.3-1.8 2-2.9 3.9-2.4
             .2-.4.6-.7 1.1-.7Z" fill="#E2571F"/>
    <path d="M8 2.4c0-.6.2-1.1.6-1.5" stroke="#3E7A32" stroke-width="1.1" stroke-linecap="round" fill="none"/>
  </svg>`;

  function dressHeader() {
    const head = document.querySelector('.rcPaper .rcHead');
    if (head && !head.querySelector('svg')) head.insertAdjacentHTML('afterbegin', PUMPKIN);
    const sub = document.getElementById('rcSub');
    if (sub && !/ALL HALLOWS/.test(sub.textContent)) {
      sub.innerHTML = 'UNIT 07 &middot; AISLE 7 &middot; ALL HALLOWS';
    }
  }

  /* row labels are left alone on purpose - they are cans on a shelf, and a
     receipt that lies about its own stock is a worse joke than no joke */
  function dressRows() {}

  function dressStamp() {
    const stamp = document.getElementById('rcStamp');
    if (!stamp) return;
    /* only the win stamp changes. The loss already says INSUFFICIENT FUNDS,
       which is the better joke and has nothing to do with sweets. */
    if (/THANK YOU FOR SHOPPING/.test(stamp.textContent)) stamp.textContent = 'TRICK OR TREAT';
  }

  const wrap = document.getElementById('receiptWrap');
  if (!wrap) return;

  /* the barcode is drawn in dark ink by the game - on dark paper it vanishes,
     so repaint the same bars in cream (keeps the pattern, flips the colour) */
  function fixBarcode() {
    const c = document.getElementById('rcBar');
    if (!c) return;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height);
    let touched = false;
    for (let i = 0; i < d.data.length; i += 4) {
      if (d.data[i + 3] > 0) {
        d.data[i] = 0xF6; d.data[i + 1] = 0xE7; d.data[i + 2] = 0xCE;
        touched = true;
      }
    }
    if (touched) g.putImageData(d, 0, 0);
  }

  const obs = new MutationObserver(() => {
    if (!wrap.classList.contains('on')) return;
    dressHeader(); dressRows(); dressStamp(); fixBarcode();
  });
  obs.observe(wrap, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
})();
