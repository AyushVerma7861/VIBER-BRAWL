/* Focus management for Viber Brawl screens. Trials keeps its own lifecycle. */
(()=>{
  const ids=['onboard','photoOverlay','scrPause','scrResults','scrChars'];
  let current=null,returnFocus=null;
  const saved=new Map();
  const focusable=el=>Array.from(el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')).filter(n=>n.getClientRects().length && !n.closest('[inert]'));
  function restore(){saved.forEach((value,el)=>{el.inert=value;});saved.clear();}
  function sync(){
    document.querySelectorAll('.charCard').forEach(card=>{
      const flipped=card.classList.contains('flipped');
      for(const [selector,hidden] of [['.cardFront',flipped],['.cardBack',!flipped]]){
        const face=card.querySelector(selector);if(face){face.inert=hidden;face.setAttribute('aria-hidden',String(hidden));}
      }
    });
    const next=ids.map(id=>document.getElementById(id)).find(el=>el&&el.classList.contains('on'))||null;
    if(next===current)return;
    restore();const previous=current;current=next;
    if(next){
      if(!previous)returnFocus=document.activeElement;
      next.setAttribute('role','dialog');next.setAttribute('aria-modal','true');
      if(!next.hasAttribute('aria-label'))next.setAttribute('aria-label',({onboard:'How to play',photoOverlay:'Victory photo',scrPause:'Paused',scrResults:'Match results',scrChars:'Choose your Viber'})[next.id]);
      for(const child of document.body.children){
        // Holder dialogs belong to the separate access/Trials flow.
        if(child===next||child.contains(next)||['SCRIPT','STYLE'].includes(child.tagName)||['gateCard','guideModal','arenaFailure'].includes(child.id))continue;
        saved.set(child,child.inert);child.inert=true;
      }
      const selected=next.querySelector('input:checked');
      const target=selected||focusable(next)[0];if(target)target.focus();
    }else if(returnFocus?.isConnected&&!returnFocus.closest('[inert]')&&returnFocus.getClientRects().length){returnFocus.focus();returnFocus=null;}
  }
  new MutationObserver(sync).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('keydown',event=>{
    if(!current||!current.classList.contains('on'))return;
    const other=['gateCard','guideModal','arenaFailure'].some(id=>{const el=document.getElementById(id);return el&&(el.classList.contains('on')||el.getAttribute('aria-hidden')==='false'||id==='arenaFailure'&&!el.hidden);});
    if(other)return;
    if(event.key==='Tab'){
      const list=focusable(current);if(!list.length)return;
      const first=list[0],last=list[list.length-1];
      if(event.shiftKey&&(document.activeElement===first||!current.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!current.contains(document.activeElement))){event.preventDefault();first.focus();}
    }
    if(event.key==='Escape'){
      const close={scrChars:'btnCharsBack',scrPause:'btnResume',scrResults:'btnMenu',photoOverlay:'btnContinuePhoto'}[current.id];
      if(close){event.preventDefault();event.stopImmediatePropagation();document.getElementById(close)?.click();}
    }
  },true);
  sync();
})();
