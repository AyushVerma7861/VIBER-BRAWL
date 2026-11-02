/* Haunted Mart presentation layer. No attack timings, collision or scoring changes. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const root = new THREE.Group(); root.name = 'Haunted Mart scenery'; scene.add(root);
  const orange = new THREE.MeshStandardMaterial({color:0xB84C16, roughness:0.86});
  const stem = new THREE.MeshStandardMaterial({color:0x473B25, roughness:1});
  const glow = new THREE.MeshBasicMaterial({color:0xFFB64D});
  const shell = new THREE.SphereGeometry(0.62,12,8);
  const pv=shell.attributes.position;for(let i=0;i<pv.count;i++){const x=pv.getX(i),z=pv.getZ(i),rib=1+.09*Math.cos(Math.atan2(z,x)*8);pv.setXYZ(i,x*rib,pv.getY(i),z*rib);}shell.computeVertexNormals();
  const stemGeo = new THREE.BoxGeometry(0.15,0.28,0.15);
  const eyeGeo = new THREE.ConeGeometry(0.12,0.18,3);
  const mouthGeo = new THREE.BoxGeometry(0.36,0.09,0.06);
  // Decorations stay along the perimeter, well outside the fighting ring.
  for (const [x,z,s,turn] of [[-12,-11,1.7,.2],[12,-11,1.4,-.3],[-18,8,1.8,.7],[18,10,1.5,-.7],[-14,16,1.1,.2]]) {
    const g=new THREE.Group(); g.position.set(x,0,z); g.scale.setScalar(s); g.rotation.y=turn;
    const body=new THREE.Mesh(shell,orange); body.scale.set(1,.8,1); body.position.y=.51; body.castShadow=true; g.add(body);
    const st=new THREE.Mesh(stemGeo,stem); st.position.y=1.08; st.rotation.z=.2; g.add(st);
    for(const ex of [-.21,.21]){const eye=new THREE.Mesh(eyeGeo,glow); eye.position.set(ex,.65,.55); g.add(eye);}
    const mouth=new THREE.Mesh(mouthGeo,glow); mouth.position.set(0,.36,.59); g.add(mouth);
    root.add(g);
  }
  // A single instanced mesh gives all perimeter embers one draw call.
  const dust=new THREE.InstancedMesh(new THREE.PlaneGeometry(.055,.055),
    new THREE.MeshBasicMaterial({color:0xFFAD59,transparent:true,opacity:.4,depthWrite:false,side:THREE.DoubleSide}),32);
  dust.frustumCulled=false; root.add(dust);
  const dummy=new THREE.Object3D();
  const warm=new THREE.PointLight(0xFF8C37,.65,24,2); warm.position.set(-12,3,-10); root.add(warm);
  const rim=new THREE.PointLight(0xA85FFF,.4,22,2); rim.position.set(10,5,-10); root.add(rim);
  // Soft ground haze at the perimeter only; the centre stays readable.
  const fogCanvas=document.createElement('canvas');fogCanvas.width=128;fogCanvas.height=128;
  const fc=fogCanvas.getContext('2d'),gradient=fc.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0,'rgba(156,121,204,.12)');gradient.addColorStop(.5,'rgba(126,100,170,.06)');gradient.addColorStop(1,'rgba(126,100,170,0)');
  fc.fillStyle=gradient;fc.fillRect(0,0,128,128);
  const mistMat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(fogCanvas),transparent:true,depthWrite:false,side:THREE.DoubleSide});
  const mistGeo=new THREE.PlaneGeometry(11,6),mists=[];
  for(const [x,z] of [[-15,-8],[15,-9],[-18,6],[18,8]]){
    const m=new THREE.Mesh(mistGeo,mistMat);m.rotation.x=-Math.PI/2;m.position.set(x,.12,z);root.add(m);mists.push({m,x,z});
  }
  let elapsed=0, audio=null, muted=false;
  try{muted=localStorage.getItem('chog-polish-muted')==='1';}catch{}
  const button=document.createElement('button');
  button.type='button'; button.style.cssText='position:fixed;right:16px;bottom:16px;z-index:90;background:#140e23;color:#f2eaff;border:1px solid #70518e;border-radius:8px;padding:10px 14px;font:12px system-ui;cursor:pointer;min-height:44px';
  button.setAttribute('aria-label','Mute game audio');
  function label(){button.textContent=muted?'Sound: off':'Sound: on';button.setAttribute('aria-pressed',String(muted));}
  button.addEventListener('click',()=>{muted=!muted; SFX.enabled=!muted; if(!muted){SFX.init();SFX.resume();} try{localStorage.setItem('chog-polish-muted',muted?'1':'0');}catch{} label();});
  label(); document.body.append(button); SFX.enabled=!muted;
  function initAudio(){
    if(audio || !SFX.ctx || !SFX.master) return;
    const c=SFX.ctx;
    const wet=c.createGain(); wet.gain.value=.10;
    const delay=c.createDelay(.2); delay.delayTime.value=.065;
    const filter=c.createBiquadFilter(); filter.type='lowpass';filter.frequency.value=2200;
    wet.connect(delay);delay.connect(filter);filter.connect(SFX.bus.P2);
    const hum=c.createGain();hum.gain.value=0;hum.connect(SFX.bus.P3);
    const motor=c.createOscillator();motor.type='sine';motor.frequency.value=57;
    const harmonic=c.createOscillator();harmonic.type='sine';harmonic.frequency.value=114;
    const harmonicGain=c.createGain();harmonicGain.gain.value=.18;
    motor.connect(hum);harmonic.connect(harmonicGain);harmonicGain.connect(hum);
    motor.start();harmonic.start();
    audio={wet,hum,motor,harmonic};
  }
  const originalPlay=SFX._play;
  // Keep every original sample and all P0 warning sounds dry and unchanged.
  SFX._play=function(name,opt){
    const stop=originalPlay.call(this,name,opt);
    if(!stop || !this._cur) return stop;
    initAudio();
    const voice=this._cur.nodes[this._cur.nodes.length-1];
    if(voice){
      if(audio && this._cur.lane!=='P0') voice.gain.connect(audio.wet);
      voice.node.onended=()=>{voice.node.disconnect();voice.gain.disconnect();};
    }
    return stop;
  };
  // A damped cabinet resonance adds physical weight to the existing impact.
  const oldHeavy=SFX.hitHeavy, oldBack=SFX.backHit;
  function resonance(){
    const c=SFX.ctx;if(!c||!SFX.enabled||PAUSED||G.rotLocked) return;
    SFX._go('cabinetResonance',()=>{
      const t=c.currentTime, o=c.createOscillator(),g=c.createGain();
      o.frequency.setValueAtTime(105,t);o.frequency.exponentialRampToValueAtTime(48,t+.16);
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.16,t+.006);g.gain.exponentialRampToValueAtTime(.0001,t+.23);
      o.connect(g);g.connect(SFX.bus.P2);o.start(t);o.stop(t+.24);
      o.onended=()=>{o.disconnect();g.disconnect();};
      SFX._cur.nodes.push({node:o,gain:g,stop:t+.24});
    });
  }
  SFX.lane.cabinetResonance='P2';SFX.cap.cabinetResonance=2;SFX.cool.cabinetResonance=.08;
  SFX.hitHeavy=function(){oldHeavy.call(this);resonance();};
  SFX.backHit=function(){oldBack.call(this);resonance();};
  const hauntedMachines=new WeakMap();
  function hauntMachine(b){
    if(hauntedMachines.has(b))return hauntedMachines.get(b);
    const root=new THREE.Group();root.name='Possessed SNAX cosmetics';b.shell.add(root);
    const metal=new THREE.MeshStandardMaterial({color:0x211925,roughness:.7,metalness:.5});
    const red=new THREE.MeshStandardMaterial({color:0x641b2b,roughness:.72,metalness:.3});
    const glow=new THREE.MeshBasicMaterial({color:0xad46ec,transparent:true,opacity:.3});
    function box(parent,x,y,z,w,h,d,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);parent.add(m);return m;}
    // A shallow service enclosure on the right leaves the left climbing vents clear.
    box(root,1.245,2.55,0,.08,1.8,1.12,metal);
    for(const z of [-.55,.55])box(root,1.31,2.55,z,.07,1.85,.045,red);
    for(const y of [1.65,3.45])box(root,1.31,y,0,.07,.05,1.15,red);
    const core=box(root,1.31,2.55,0,.08,.72,.32,glow);
    for(const z of [-.34,.34]){
      box(root,1.32,2.55,z,.07,1.3,.045,metal);
      for(const y of [2,3.1])box(root,1.33,y,z,.08,.08,.1,glow);
    }
    const hinge=new THREE.Group();hinge.position.set(1.36,2.55,-.55);root.add(hinge);
    box(hinge,0,0,.55,.07,1.76,1.1,red);
    for(let i=0;i<5;i++)box(hinge,.041,-.48+i*.18,.57,.012,.045,.6,metal);
    const seams=[];
    for(const x of [-1.065,1.065])seams.push(box(root,x,1.45,.763,.017,.91,.012,glow));
    seams.push(box(root,0,4.99,.766,2.12,.014,.014,glow));
    // Deterministic chips follow the red frame, never the cans/health display.
    const chips=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),metal,65),o=new THREE.Object3D();
    for(let i=0;i<65;i++){
      const u=((i*37)%67)/67,v=((i*19)%71)/71;
      o.position.set(i%2?-.99+u*1.98:(i%4?1.06:-1.06),i%2?.86+v*.14:1.1+v*3.7,.77);
      o.rotation.z=u*.8;o.scale.set(.02+u*.075,.008+v*.023,.006);o.updateMatrix();chips.setMatrixAt(i,o.matrix);
    }root.add(chips);
    const cv=document.createElement('canvas');cv.width=256;cv.height=128;
    const ctx=cv.getContext('2d');ctx.fillStyle='#100d15';ctx.fillRect(0,0,256,128);ctx.fillStyle='#ffb764';ctx.font='bold 32px monospace';ctx.textAlign='center';ctx.fillText('NO',128,49);ctx.fillText('REFUNDS',128,91);
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(.39,.25),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv)}));screen.position.set(.86,4.21,.91);root.add(screen);
    const state={root,hinge,glow,core,phase:1};hauntedMachines.set(b,state);return state;
  }
  function updateHaunting(b,dt,frozen){
    if(!b)return;const h=hauntMachine(b),phase=Math.max(1,Math.min(3,b.phase||1));h.phase=phase;
    const target=phase===3?1.12:phase===2?.18:0;
    if(!frozen)h.hinge.rotation.y+=(target-h.hinge.rotation.y)*(1-Math.exp(-5*Math.min(dt,.05)));
    h.glow.opacity=b.dead?.06:([0,.2,.42,.7][phase]);
    h.core.visible=phase>1;
  }
  function tick(dt){
    const tutorial=document.getElementById('scrHow').classList.contains('on');
    const frozen=PAUSED||G.rotLocked||document.hidden||tutorial;
    updateHaunting(boss,dt,frozen);
    if(!frozen) elapsed+=Math.min(dt,.05);
    const phase=boss&&!boss.dead?boss.phase:0;
    rim.intensity=.4+Math.min(phase,2)*.15;
    warm.intensity=reduced.matches?.65:.65+Math.sin(elapsed*1.6)*.035;
    for(let i=0;i<mists.length;i++){const f=mists[i];f.m.position.x=f.x+(reduced.matches?0:Math.sin(elapsed*.18+i)*.6);}
    dust.visible=!reduced.matches;
    if(!frozen && dust.visible){
      for(let i=0;i<32;i++){
        const angle=i*2.39996;
        dummy.position.set(Math.cos(angle)*18, .4+((elapsed*.12+i*.137)%2.5),Math.sin(angle)*18+2);
        dummy.quaternion.copy(camera.quaternion);dummy.updateMatrix();dust.setMatrixAt(i,dummy.matrix);
      }
      dust.instanceMatrix.needsUpdate=true;
    }
    initAudio();
    if(audio){
      const c=SFX.ctx,active=!frozen&&!muted&&SFX.enabled;
      // Suppress ambience in windups so existing warnings stay intelligible.
      const fight=G.mode==='fight'&&boss&&!boss.dead;
      const level=active&&fight?(boss.phaseState==='windup'?.006:.025):0;
      audio.hum.gain.setTargetAtTime(level,c.currentTime,.10);
      SFX.master.gain.setTargetAtTime(active?.7:0,c.currentTime,.025);
    }
    button.style.display=G.mode==='fight'&&!PAUSED?'none':'';
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&SFX.master)SFX.master.gain.setTargetAtTime(0,SFX.ctx.currentTime,.025);});
  window.TrialsPolish={tick,info:()=>({theme:'Midnight Mart',muted,ready:!!audio,decorations:5,embers:32,reducedMotion:reduced.matches})};
})();
