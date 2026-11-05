/* Shared receipt theme for on-screen and exported results. */
(() => {
  'use strict';

  const theme = window.ReceiptTheme = {
    paper:'#191009', ink:'#F6E7CE', muted:'#B98150', hero:'#FFD9A8',
    accent:'#E2571F', rule:'#3A2416', fail:'#F09595',
    subtitle:'UNIT 07 · AISLE 7 · ALL HALLOWS', stamp:'TRICK OR TREAT',
    drawPumpkin(g,x,y,size){
      const svg = document.querySelector('.rcHead svg');
      if(!svg) return;
      g.save(); g.translate(x,y); g.scale(size/16,size/16);
      for(const p of svg.querySelectorAll('path')) {
        const path = new Path2D(p.getAttribute('d'));
        if(p.getAttribute('fill') !== 'none'){ g.fillStyle=p.getAttribute('fill'); g.fill(path); }
        if(p.hasAttribute('stroke')){g.strokeStyle=p.getAttribute('stroke');g.lineWidth=1.1;g.stroke(path);}
      }
      g.restore();
    }
  };
  const css = `
    #receiptWrap{ background:rgba(6,3,1,.82); }
    .rcPaper{ background:${theme.paper}; color:${theme.ink};
      box-shadow:0 30px 70px rgba(0,0,0,.8), inset 0 0 0 1px rgba(226,87,31,.34); }
    .rcPaper::after{ background:repeating-linear-gradient(-45deg,${theme.paper} 0 7px,transparent 7px 14px); }
    .rcHead{ color:${theme.ink}; display:flex; align-items:center; justify-content:center; gap:6px; }
    .rcHead svg{ display:block; }
    .rcSub{ color:${theme.muted}; }
    .rcHero span{ color:${theme.accent}; }
    .rcHero b{ color:${theme.hero}; }
    .rcId i{ color:${theme.muted}; }
    .rcRow{ border-top-color:${theme.rule}; }
    .rcRow.first{ border-top-color:#5A3A22; }
    .rcStamp{ color:${theme.accent}; }
    .rcStamp.fail{ color:${theme.fail}; }
    #rcShare{ background:${theme.accent}; color:#200A03; }
    #rcSave{ background:${theme.ink}; color:${theme.paper}; }
    /* The visible receipt uses the same renderer as SAVE/SHARE. Keep the
       original text accessible to screen readers without a second design. */
    .rcPaper{width:min(1000px,96vw,74vh)!important;padding:0!important;background:transparent;box-shadow:none;}
    .rcPaper::after{display:none;}
    .rcPaper > :not(.rcPreview){position:absolute!important;width:1px!important;
      height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden;
      clip:rect(0,0,0,0);white-space:nowrap;}
    .rcPreview{display:block;width:100%;height:auto;}
    #rcShare:disabled{opacity:.45;cursor:wait;}
    #rcShareHelp{max-width:540px;margin:12px auto 0;padding:12px;background:#191009;
      color:#F6E7CE;border:1px solid #5A3A22;font:13px/1.5 system-ui;text-align:center;}
    #rcShareHelp p{margin:0 0 8px;}
    #rcShareHelp a{color:#FFD9A8;font-weight:700;}
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

  const head = document.querySelector('.rcPaper .rcHead');
  if(head) head.insertAdjacentHTML('afterbegin', PUMPKIN);
})();
