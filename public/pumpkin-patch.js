/* Pumpkin Patch extends the existing renderer, rigs, physics and match rules.
   Persistent meshes are pooled; spells and projectiles are reset each match. */
'use strict';
const PumpkinPatch = (() => {
  const base = {applyMap, applyHazardsForDifficulty, assignActiveFighters, startMatch,
    resetToMenu, updateWorld, stepFighter, aiControl, tryHit, useAbility, spawnPowerup, applyPowerup};
  const harvestPickups = {
    spark: ['CANDY RUSH','Ripens the nearest growing pumpkin',0xf16083],
    power: ['WITCH BREW','Quick strikes launch pumpkins',0xb76de2],
    shield: ['SPIRIT WARD','A full block returns a pumpkin',0x67efc2],
    dash: ['GHOST STEP','Dash through rolling pumpkins',0xbc9cf4]
  };
  const state = {enabled:false, group:new THREE.Group(), pumpkins:[], spells:[], age:0};
  const originalPlatforms=platforms.slice(), originalSpawns=spawnPoints.map(p=>p.slice());
  const patchPlatforms=[];
  scene.add(state.group); state.group.visible=false;
  MAPS.pumpkin={...MAPS.dungeon,name:'PUMPKIN PATCH',sky:0x20273b,
    hemiSky:0xa6a5c5,hemiGround:0x59432f,hemiIntensity:0.95,sunColor:0xffd09a,sunIntensity:0.7};
  const mats={};
  function mat(c,glow=false){ const k=c+'_'+glow; return mats[k]||(mats[k]=new THREE.MeshLambertMaterial({color:c,emissive:glow?c:0,emissiveIntensity:glow?0.38:0})); }
  function box(parent,w,h,d,c,x,y,z,glow=false){ const m=mkBox(w,h,d,mat(c,glow));m.position.set(x,y,z);parent.add(m);return m; }
  function floor(x,z,w,d,y,h,c,walk=true){const m=box(state.group,w,h,d,c,x,y-h/2,z);if(walk)patchPlatforms.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,top:y});return m;}
  // Broad stepped garden silhouette. No missing corner physics or invisible floor.
  const soil=PatchArt.gardenSoil();
  function gardenSlab(x,width,depth){
    const slab=floor(x,0,width,depth,0,1.1,0xa17a59),side=slab.material;
    const tile=soil.clone();tile.repeat.set(width/8,depth/8);tile.needsUpdate=true;
    const top=side.clone();top.map=tile;
    slab.material=[side,side,top,side,side,side];
  }
  gardenSlab(0,38,34);
  for(const side of [-1,1])gardenSlab(side*20.5,3,22);
  floor(0,0,35,30,-1.1,3,0x806c51,false);
  const outline=[[-19,-17],[19,-17],[19,-11],[22,-11],[22,11],[19,11],[19,17],[-19,17],[-19,11],[-22,11],[-22,-11],[-19,-11]];
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
    const wall=box(state.group,len+0.5,0.85,0.65,0x75627c,(a[0]+b[0])/2,0.42,(a[1]+b[1])/2);wall.rotation.y=-Math.atan2(dz,dx);
    const count=Math.ceil(len/2.7);
    for(let j=0;j<count;j++){
      const t=(j+.5)/count,cap=box(state.group,len/count-.08,.31,.96,[0xb097a9,0xa28a9e,0xaa90a5][j%3],a[0]+dx*t,.81,a[1]+dz*t);
      cap.rotation.y=wall.rotation.y;
    }
  }
  // Low, walkable soil beds: no solid furniture to trap bots.
  for(const [x,z] of [[-10,-10],[10,10]]){
    floor(x,z,8,3.6,0.32,0.32,0x796783);
    floor(x,z,7.3,2.9,0.38,0.1,0x63513c);
    for(let i=-2;i<=2;i++){
      box(state.group,0.18,0.35,0.18,0x476044,x+i*1.25,0.55,z);
      const leaf=box(state.group,0.7,0.12,0.35,0x607644,x+i*1.25+0.22,0.63,z);leaf.rotation.z=0.2;
    }
  }
  // Sparse dirt seams retain the original game's large slab / mesh-outline style.
  const windmill=PatchArt.homestead(state.group);
  function pumpkinMesh(size=1){
    const g=new THREE.Group();
    for(let i=-2;i<=2;i++){
      const depth=1.86-Math.abs(i)*0.26,height=1.72-Math.abs(i)*0.16;
      box(g,.46,height,depth,i%2?0xcc591c:0xe87824,i*.40,0.85,0);
    }
    box(g,0.28,0.55,0.28,0x557044,0,1.95,0);
    for(const side of [-1,1]){
      for(const x of [-0.42,0.42])box(g,0.34,0.26,0.13,0xffdb75,x,1.12,side*0.84,true).rotation.z=x*.4;
      box(g,0.78,0.15,0.1,0x392b31,0,0.57,side*.96);
      box(g,0.18,0.16,0.1,0xffdb75,0,0.66,side*.985,true);
    }
    box(g,.58,.13,.32,0x718650,.27,1.84,.05).rotation.z=.28;
    g.scale.setScalar(size); return g;
  }
  for(const [i,x,z] of [[0,-17,4],[1,17,-4],[2,0,-14],[3,0,14]]){
    floor(x,z,3.2,3.2,0.18,0.18,0x776483);
    const mesh=new THREE.Group(),rind=pumpkinMesh(1);rind.position.y=-.85;mesh.add(rind);state.group.add(mesh);
    // Thin ground cue remains visible through the ripening squash animation.
    const cue=box(state.group,2.8,0.025,2.8,0x698854,x,0.2,z,true);
    const gleam=new THREE.Group();state.group.add(gleam);
    for(let ray=-1;ray<=1;ray++){
      box(gleam,.13,.45,.13,0xffdb65,ray*.39,.19-Math.abs(ray)*.09,0,true).rotation.z=-ray*.55;
    }
    state.pumpkins.push({homeX:x,homeZ:z,x,z,mesh,cue,gleam,phase:'growing',t:2+i*0.8,vx:0,vz:0,owner:null,hit:new Set(),cooldown:0});
  }
  // Landscape-native hanging rectangular lanterns and restrained perimeter dressing.
  for(const [x,z]of [[-18,-16],[18,-16],[-18,16],[18,16]]){
    box(state.group,0.12,5.4,0.12,0x25232e,x,7,z);
    box(state.group,1,1.65,1,0x25232e,x,4,z);
    box(state.group,0.77,1.25,1.03,0xffd36a,x,4,z,true);
    box(state.group,1.03,1.25,0.77,0xffd36a,x,4,z,true);
  }
  function costume(def){
    if(def.id==='spiky')return def;
    const d={...def,colors:{...def.colors},headExtras:(def.headExtras||[]).map(p=>({...p})),bodyExtras:(def.bodyExtras||[]).map(p=>({...p}))};
    const extra=(list,w,h,depth,x,y,z,c)=>list.push({w,h,d:depth,x,y,z,c});
    const forms={
      miner:['PUMPKIN MINER','GRAVEBREAKER','Swing your pick to send a line of grave stones up through the soil.'],
      moss:['FRANKEN-MOSS','GRAVE GRIP','Summon spectral hands that hold nearby grounded rivals.'],
      volt:['MAD VOLT','ARC DASH','Blink ahead and leave a crackling trail behind.'],
      phantom:['VAMPIRE PHANTOM','BAT SLIP','Slip through attacks and leave a fading double behind.']
    };
    [d.name,d.abilityName,d.abilityDesc]=forms[d.id];
    d.img='patch-'+d.id+'.png';
    // Build the reference faces and costumes on the game's articulated joints.
    d.headExtras=[]; d.bodyExtras=[];d.armExtrasL=[];d.armExtrasR=[];
    const head=(...p)=>extra(d.headExtras,...p), coat=(...p)=>extra(d.bodyExtras,...p);
    d.ghost=false;
    if(d.id==='miner'){
      Object.assign(d.colors,{head:0xe58329,visor:0xb5753c,accent:0xef9930,body:0x35323a,arm:0x443638,foot:0x322e34});
      for(const [x,h] of [[-.43,.52],[0,.94],[.39,.69]]) head(.23,h,.27,x,.73+h/2,-.12,0x8b5732);
      for(const x of [-.43,.43]){head(.56,.38,.1,x,.12,.87,0x4f2b20);head(.39,.22,.12,x,.10,.92,0xffcd57);}
      head(1.22,.23,.10,0,-.40,.88,0x492920);
      for(const x of [-.42,.02,.43])head(.17,.16,.12,x,-.32,.94,0xe69032);
      for(const x of [-.46,.46])coat(.16,.86,1.14,x,1.13,0,0x91623b);
      extra(d.armExtrasR,.16,1.65,.16,0,-.42,.42,0x79543a);
      extra(d.armExtrasR,1.08,.2,.25,0,.37,.44,0xb9b2a2);
      for(const s of [-1,1])extra(d.armExtrasR,.22,.36,.24,s*.5,.23,.44,0x999585);
    }else if(d.id==='moss'){
      Object.assign(d.colors,{head:0x407252,body:0x305549,arm:0x416c4c,foot:0x28433c});
      head(1.98,.26,1.88,0,.73,0,0x294d3c);head(1.31,.19,1.24,0,.94,-.02,0x396447);
      for(const x of [-.45,.45]){head(.73,.71,.14,x,-.13,.89,0x7cdbbd);head(.44,.46,.15,x,-.13,.98,0xe7ddbb);
        head(.4,.27,.36,Math.sign(x)*1.01,-.30,-.04,0xb7ada2);}
      head(.82,.075,.08,.06,.44,.88,0xcfc3a3);
      for(const x of [-.2,.04,.29])head(.075,.22,.09,x,.44,.91,0xd9caa9);
      coat(.98,.61,1.09,0,1.1,0,0x40443c);coat(.38,.35,.1,.27,1.12,.59,0x91a578);
    }else if(d.id==='volt'){
      Object.assign(d.colors,{head:0xb4b5b6,body:0xa5adb8,arm:0x536da4,foot:0xe5a143});
      for(const x of [-.49,.49]){head(.22,.79,.24,x,1.12,-.04,0x272836);head(.38,.36,.39,x,1.65,-.04,0xffbd4b);
        head(.63,.17,.16,x,.18,.9,0x373440);head(.30,.32,.13,x,-.06,.91,0xf4a141);}
      head(.22,.18,.13,0,-.32,.90,0x383540);
      for(const x of [-.45,.45])coat(.44,.84,1.12,x,1.1,.01,0x637da9);
      coat(.18,.48,.11,0,1.13,.61,0xe8ac56);
    }else{
      Object.assign(d.colors,{head:0x8b60ac,body:0x67477e,arm:0x613a70,foot:0x383344});
      head(.86,.43,.86,0,.91,0,0xe6ddc6);head(.25,.16,.24,0,1.2,0,0xd8cdb3);
      head(1.73,.70,.13,0,-.08,.85,0x282836);
      for(const x of [-.43,.43]){head(.4,.18,.08,x,.02,.95,0xb6d8e6);head(.15,.24,.1,x*.66,-.37,.96,0xf1dfbe);}
      for(const s of [-1,1]){
        coat(.85,1.46,.2,s*.61,1.02,-.70,0x693349);d.bodyExtras.at(-1).rz=s*.21;
        coat(.65,.26,.66,s*.66,1.6,-.22,0xa74758);d.bodyExtras.at(-1).rz=s*.36;
      }
    }
    return d;
  }
  function tailor(def){
    const model=buildViber(def);
    if(def.id==='spiky')return model;
    function fabric(group,w,h,d,color,x,y,z){
      const material=new THREE.MeshLambertMaterial({color});
      model.mats.push(material);
      const mesh=mkBox(w,h,d,material);mesh.position.set(x,y,z);group.add(mesh);return mesh;
    }
    const sole={miner:0x684732,moss:0x83cdb0,volt:0xffad3e,phantom:0x302d39}[def.id];
    for(const leg of [model.legL,model.legR]){
      fabric(leg,.52,.20,.78,sole,0,-.56,.09);
      fabric(leg,.53,.12,.59,def.colors.arm,0,-.35,.02);
    }
    for(const arm of [model.armL,model.armR]){
      fabric(arm,.53,.30,.6,def.colors.body,0,-.1,0);
      fabric(arm,.52,.22,.60,def.id==='volt'?0x745c48:0x58443e,0,-.67,.02);
    }
    if(def.id==='miner'){
      // Tip the pick out past the shoulder so its hook reads from the orbit camera.
      const tool=new THREE.Group();tool.position.set(.16,-.54,.44);model.armR.add(tool);
      for(const part of model.armR.children.slice()){
        if(part!==tool&&part.position.z>=.4){tool.attach(part);}
      }
      tool.rotation.z=-.57;tool.rotation.x=.35;
      fabric(model.bodyPivot,.84,.71,.52,0x845736,0,1.14,-.68);
    }else if(def.id==='moss'){
      for(const s of [-1,1])fabric(model.bodyPivot,.07,.31,.10,0xb5b495,-.32,1.15,.58).rotation.z=s*.7;
    }else if(def.id==='phantom'){
      const cape=new THREE.Group();cape.position.set(0,1.5,-.57);model.bodyPivot.add(cape);
      for(const s of [-1,1]){
        fabric(cape,.92,1.4,.17,0x642c43,s*.47,-.64,-.16).rotation.z=s*.17;
        fabric(cape,.34,.43,.19,0x7c374e,s*.82,-1.23,-.16).rotation.z=s*.17;
      }
      model.cape=cape;
    }
    return model;
  }
  function dress(on){
    for(const f of fighterPool){
      if(!f.patchOriginal)f.patchOriginal={def:f.def,model:f.model,group:f.group};
      const orig=f.patchOriginal;
      if(on&&!f.patchModel){const def=costume(orig.def);const model=tailor(def);scene.add(model.root);f.patchModel={def,model,group:model.root};}
      const next=on?f.patchModel:orig;
      const visible=f.group.visible;f.group.visible=false;
      f.def=next.def;f.model=next.model;f.group=next.group;
      f.group.position.copy(f.pos);f.group.rotation.y=f.facing;f.group.visible=visible;
    }
  }
  function reset(){
    state.age=0;
    for(const s of state.spells){scene.remove(s.mesh);disposeArenaEffect(s.mesh,Object.values(mats));}state.spells.length=0;
    for(const [i,p]of state.pumpkins.entries()){
      Object.assign(p,{x:p.homeX,z:p.homeZ,phase:'growing',t:2+i*0.8,growDuration:4.8,vx:0,vz:0,owner:null,cooldown:0,bump:0,bumpUntil:0,rollAge:0});
      p.mesh.rotation.set(0,Math.atan2(-p.homeX,-p.homeZ),0);
    }
    for(const f of fighterPool){f.patchRoot=0;f.patchDecoy=0;f.patchCast=0;}
    posePumpkins();
  }
  function configure(id){
    const on=id==='pumpkin';
    const sub=document.querySelector('#scrChars > .panel > .sub');
    if(sub)sub.textContent=on?'Halloween forms & abilities. Heavy-hit ripe pumpkins; jump or redirect rolling ones.':'Pick a fighter. Three AI Vibers will be waiting.';
    document.querySelectorAll('.diffbtn').forEach(b=>{const label=b.querySelector('span');if(label)label.textContent=(on?{easy:'gentle pumpkins',medium:'standard pumpkins',hard:'faster pumpkins'}:{easy:'no hazards',medium:'spike pads',hard:'spikes + spin rod'})[b.dataset.diff];});
    if(on!==state.enabled){
      reset();state.enabled=on;state.group.visible=on;arenaGroup.visible=!on;
      platforms.splice(0,platforms.length,...(on?patchPlatforms:originalPlatforms));
      MAP._n=-1;spawnPoints=on?[[10,0,-6],[-10,0,6],[10,0,6],[-10,0,-6]]:originalSpawns.map(p=>p.slice());
      dress(on);
      if(document.getElementById('charGrid').children.length)buildCharGrid();
      if(!on)base.applyHazardsForDifficulty(Game.mode==='tutorial'?'easy':Game.difficulty);
    }
    if(on){lanternGroup.visible=false;hazards.spinEnabled=false;hazards.padsEnabled=false;hazards.spinBar.visible=false;for(const p of hazards.pads)p.grp.visible=false;}
  }
  function active(){return state.enabled&&Game.mode==='play'&&!Game.over&&Game.countdown<=0&&!Game.paused&&!Game.rotPaused&&!Tutorial.active;}
  function limit(f){
    if(f.state!=='active')return;
    const z=clamp(f.pos.z,-15.9,15.9),bound=Math.abs(z)>10.2?17.9:20.9,x=clamp(f.pos.x,-bound,bound);
    if(x!==f.pos.x){f.vx*= -0.18;f.pos.x=x;}
    if(z!==f.pos.z){f.vz*= -0.18;f.pos.z=z;}
  }
  function launch(p,f,dx,dz){
    const len=Math.hypot(dx,dz)||1,speed=Game.difficulty==='easy'?14:Game.difficulty==='hard'?22:19;p.vx=dx/len*speed;p.vz=dz/len*speed;
    p.phase='rolling';p.t=2.6;p.owner=f;p.hit.clear();p.cooldown=0.14;p.banks=0;p.rollAge=0;
    p.mesh.scale.set(1.25,0.88,1.25);SFX.hitHeavy();
    burst(p.x,0.8,p.z,0xffb34d,10,6,0.35,0.5);impactRing(p.x,.34,p.z,0xffc66a,1.05);
    Game.hitStop=Math.max(Game.hitStop,.045);Game.shake=Math.max(Game.shake,.24);
  }
  function bodyContact(f){
    if(!active()||f.state!=='active'||f.pos.y>1.9)return;
    for(const p of state.pumpkins){
      if(p.phase!=='ripe')continue;
      const dx=f.pos.x-p.x,dz=f.pos.z-p.z,dist=Math.hypot(dx,dz);
      if(dist>=1.65)continue;
      const nx=dist>.001?dx/dist:-Math.sin(f.facing),nz=dist>.001?dz/dist:-Math.cos(f.facing);
      if(f.dashT>0){launch(p,f,-nx,-nz);continue;}
      f.pos.x=p.x+nx*1.65;f.pos.z=p.z+nz*1.65;
      const inward=f.vx*nx+f.vz*nz;
      if(inward<0){f.vx-=inward*nx;f.vz-=inward*nz;}
      if(!p.bumpUntil||p.bumpUntil<state.age){p.bumpUntil=state.age+.32;p.bump=1;burst(p.x,0.3,p.z,0xa5ae60,4,2.8,.24,.36);}
    }
  }
  function strike(f){
    if(!active()||!f.attackType)return;
    for(const p of state.pumpkins){
      if(p.phase==='growing'||p.cooldown>0||f.hitSet.has(p))continue;
      const dx=p.x-f.pos.x,dz=p.z-f.pos.z,d=Math.hypot(dx,dz);
      if(d>4.3||Math.abs(f.pos.y)>2.2||d>0.1&&(dx*Math.sin(f.facing)+dz*Math.cos(f.facing))/d<0.25)continue;
      f.hitSet.add(p);
      if(f.attackType==='quick'&&p.phase==='ripe'){
        if(f.damageBuff>0)launch(p,f,Math.sin(f.facing),Math.cos(f.facing));
        else{p.bump=1;impactRing(p.x,.65,p.z,0xf1c779,.65);SFX.hitLight();}
        continue;
      }
      if(f.attackType!=='heavy')continue;
      launch(p,f,Math.sin(f.facing),Math.cos(f.facing));
    }
  }
  function shatter(p){
    burst(p.x,1,p.z,0xe5822b,16,9,0.6,1.1);
    burst(p.x,1.2,p.z,0xffdfa0,10,6,0.48,0.62);
    burst(p.x,.9,p.z,0x70915a,5,7,.5,.8);
    impactRing(p.x,.27,p.z,0xffc568,1.6);
    p.phase='growing';p.t=Game.difficulty==='easy'?9:Game.difficulty==='hard'?5:7;p.growDuration=p.t;p.owner=null;p.vx=p.vz=0;p.mesh.rotation.set(0,0,0);
  }
  function posePumpkins(){for(const p of state.pumpkins){
    p.mesh.position.set(p.x,.22,p.z);p.mesh.visible=true;
    const s=p.phase==='growing'?0.12+0.98*clamp(1-p.t/(p.growDuration||7),0,1):1.1;
    const squash=p.bump||0;p.bump=squash*.8;
    p.mesh.scale.set(s*(1+.13*squash),s*(1-.18*squash),s*(1+.13*squash));
    p.mesh.position.y+=.85*s;
    if(p.phase==='ripe'){p.mesh.rotation.z=Math.sin(state.age*3+p.homeX)*.045+squash*.15;p.mesh.position.y+=Math.sin(state.age*2)*.05;}
    if(p.phase==='rolling')p.mesh.position.y+=Math.abs(Math.sin(p.rollAge*10))*.17;
    p.cue.material=mat(p.phase==='ripe'?0xe4ad4b:0x698854,true);
    p.gleam.visible=p.phase==='ripe';
    if(p.gleam.visible){
      p.gleam.position.set(p.x,2.62+Math.sin(state.age*4)*.10,p.z);
      p.gleam.quaternion.copy(camera.quaternion);
      p.gleam.scale.setScalar(.88+.13*Math.sin(state.age*5));
    }
  }}
  function segmentDistance(x,z,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-ax-dx*t,z-az-dz*t);}
  function spell(f,kind){
    const dx=Math.sin(f.facing),dz=Math.cos(f.facing),mesh=new THREE.Group();
    const s={owner:f,kind,x:f.pos.x,z:f.pos.z,dx,dz,t:0,mesh,hit:new Set()};scene.add(mesh);state.spells.push(s);
    const count=kind==='grip'?10:7;
    for(let i=0;i<count;i++){
      const a=i/count*TAU,x=kind==='grip'?s.x+Math.cos(a)*4.6:s.x+dx*(i+1)*1.3,
        z=kind==='grip'?s.z+Math.sin(a)*4.6:s.z+dz*(i+1)*1.3;
      const anchor=new THREE.Group();anchor.position.set(x,0,z);mesh.add(anchor);
      box(anchor,kind==='grip'?0.65:1.35,0.04,kind==='grip'?0.65:1.35,0xffd36a,0,0.07,0,true);
      const effect=new THREE.Group();effect.visible=false;anchor.add(effect);anchor.userData.effect=effect;
      if(kind==='grip'){
        box(effect,0.45,0.5,0.25,0x90e5bb,0,0.28,0,true);
        for(let j=0;j<4;j++)box(effect,0.085,0.25+(j%2)*0.1,0.12,0xc3f2d3,-0.17+j*0.11,0.63,0,true);
        box(effect,0.2,0.14,0.15,0x90e5bb,0.3,0.35,0,true);
      }else if(kind==='arc'){
        for(let j=0;j<3;j++){
          const bolt=box(effect,.12,.48,.13, j===1?0xbbefff:0xffdf78,j%2*.13,.24+j*.31,0,true);
          bolt.rotation.z=j%2?.68:-.68;
        }
      }else{
        const rock=box(effect,0.75,0.8+(i%3)*0.18,0.7,0x796783,0,0.3,0);rock.rotation.z=i%2?0.25:-0.2;
      }
    }
    return s;
  }
  function inSpell(s,f){
    if(s.kind==='grip')return Math.hypot(f.pos.x-s.x,f.pos.z-s.z)<4.8;
    return segmentDistance(f.pos.x,f.pos.z,s.x,s.z,s.x+s.dx*(s.length||9),s.z+s.dz*(s.length||9))<1.55;
  }
  function tick(dt){
    state.age+=dt;
    windmill.rotation.z+=dt*.37;
    for(const p of state.pumpkins){
      p.cooldown=Math.max(0,p.cooldown-dt);p.t-=dt;
      if(p.phase==='growing'){p.x=p.homeX;p.z=p.homeZ;if(p.t<=0)p.phase='ripe';}
      if(p.phase!=='rolling')continue;
      const ox=p.x,oz=p.z;p.x+=p.vx*dt;p.z+=p.vz*dt;
      p.rollAge+=dt;
      p.mesh.rotation.x+=p.vz*dt*0.65;p.mesh.rotation.z-=p.vx*dt*0.65;
      const bound=Math.abs(p.z)>10?17.5:20.5;
      if(p.t<=0){shatter(p);continue;}
      if(Math.abs(p.x)>bound||Math.abs(p.z)>15.5){
        if(p.banks>=1){shatter(p);continue;}
        if(Math.abs(p.x)>bound){p.x=clamp(p.x,-bound,bound);p.vx*=-.90;}
        if(Math.abs(p.z)>15.5){p.z=clamp(p.z,-15.5,15.5);p.vz*=-.90;}
        p.banks++;p.bump=1;impactRing(p.x,.5,p.z,0xffba5a,.95);burst(p.x,.7,p.z,0xd2a665,8,4,.3,.6);SFX.land(.55);
      }
      for(const f of fighters){
        if(f===p.owner||p.hit.has(f)||f.state!=='active'||f.pos.y>2.2)continue;
        if(segmentDistance(f.pos.x,f.pos.z,ox,oz,p.x,p.z)>1.65)continue;
        if(f.invuln>0||f.phaseT>0||(f.dashBuff>0&&f.dashT>0))continue;
        const hit=resolveShieldDamage(f,Game.difficulty==='easy'?10:Game.difficulty==='hard'?17:14,p.owner);
        if(!hit)continue;
        if(hit.absorbed>0&&hit.damage===0){
          launch(p,f,-p.vx,-p.vz);
          impactRing(p.x,1,p.z,0x67efc2,1.45);
          if(f.isPlayer)announce('SPIRIT WARD RETURN!',.7,'small');
          break;
        }
        p.hit.add(f);
        const l=Math.hypot(p.vx,p.vz)||1;f.vx=p.vx/l*15;f.vz=p.vz/l*15;f.vy=Math.max(f.vy,9);
        f.hitstun=0.34;f.moveLock=0.29;f.flash=0.20;Game.shake=Math.max(Game.shake,0.58);Game.hitStop=Math.max(Game.hitStop,.08);SFX.hitHeavy();
        if(f.health<=0){f.health=0;koFighter(f,p.owner,'ko');}
        else if(p.owner?.isPlayer)announce(p.banks?'PUMPKIN BANK SHOT!':'PUMPKIN HIT!',.65,'small');
        shatter(p);break;
      }
    }
    posePumpkins();
    for(let i=state.spells.length-1;i>=0;i--){
      const s=state.spells[i];s.t+=dt;
      if(s.kind==='decoy'){
        const fade=clamp(1-s.t/.9,0,1);
        for(const m of s.materials)m.opacity=.42*fade;
        s.mesh.rotation.y+=dt*.8;s.mesh.position.y=s.baseY+Math.sin(s.t*3)*.28;
        for(const [j,bat] of s.bats.entries()){
          const a=j*2.4+s.t*1.7;bat.position.set(Math.cos(a)*s.t*2.4,1.3+s.t*(1+j*.22),Math.sin(a)*s.t*2.4);
          bat.rotation.z=Math.sin(s.t*24+j)*.55;bat.scale.setScalar(fade);
        }
      }
      else{
        const onset=s.kind==='arc'?.08:.53, live=s.t>=onset;
        if(live&&!s.sounded){s.sounded=true;if(s.kind==='quake'){SFX.land(.95);Game.shake=Math.max(Game.shake,.33);}else SFX.tone(s.kind==='arc'?620:175,.13,'triangle',.09);}
        for(const [j,m] of s.mesh.children.entries()){
          const e=m.userData.effect,delay=s.kind==='quake'?j*.019:0,age=s.t-onset-delay;
          e.visible=age>=0;
          m.children[0].visible=age<.03;
          e.scale.y=age<0?.01:Math.max(.02,Math.min(1,age*16)*Math.min(1,(1.15-s.t)*6));
          if(s.kind==='arc'){e.rotation.y=j+s.t*12;e.scale.x=.78+Math.sin(s.t*30+j)*.2;}
          if(s.kind==='grip')e.rotation.z=Math.sin(s.t*8+j)*.15;
        }
        if(live)for(const f of fighters){
          if(f===s.owner||s.hit.has(f)||f.state!=='active'||f.pos.y>1||!inSpell(s,f))continue;
          if(s.kind==='quake'&&s.t<onset+Math.max(0,(f.pos.x-s.x)*s.dx+(f.pos.z-s.z)*s.dz)*.014)continue;
          const h=resolveShieldDamage(f,s.kind==='grip'?9:15,s.owner);if(!h)continue;s.hit.add(f);
          if(s.kind==='grip'){f.patchRoot=0.65;f.vx*=0.2;f.vz*=0.2;}
          else{f.vy=Math.max(f.vy,12);f.hitstun=Math.max(f.hitstun,0.25);}
          f.flash=0.18;burst(f.pos.x,0.7,f.pos.z,0x90e5bb,12,6,0.4,0.55);SFX.hitHeavy();
          if(f.health<=0){f.health=0;koFighter(f,s.owner,'ko');}
        }
      }
      const life=s.kind==='arc'?1.3:s.kind==='decoy'?0.9:1.15;
      if(s.t>life){scene.remove(s.mesh);disposeArenaEffect(s.mesh,Object.values(mats));state.spells.splice(i,1);}
    }
  }
  applyMap=function(id){base.applyMap(id);configure(id);};
  applyHazardsForDifficulty=function(d){base.applyHazardsForDifficulty(d);if(state.enabled)configure('pumpkin');};
  assignActiveFighters=function(index,tutorial){
    base.assignActiveFighters(index,tutorial);
    if(!state.enabled||tutorial||player.def.id==='spiky')return;
    fighters=[player,...fighterPool.filter(f=>f!==player&&f.def.id!=='spiky')];
    fighterPool.forEach(f=>{if(!fighters.includes(f)){f.state='dead';f.group.visible=false;}});
    fighters.forEach((f,i)=>f.index=i);
  };
  startMatch=function(index,tutorial){
    if(tutorial&&Game.map==='pumpkin'){Game.map='dungeon';document.querySelectorAll('.mapbtn').forEach(b=>{b.classList.toggle('sel',b.dataset.map===Game.map);b.setAttribute('aria-pressed',String(b.dataset.map===Game.map));});}
    reset();base.startMatch(index,tutorial);
  };
  resetToMenu=function(){reset();base.resetToMenu();};
  tryHit=function(f){base.tryHit(f);strike(f);};
  useAbility=function(f){
    if(!active()||f.abilityCd>0){base.useAbility(f);return;}
    if(f.def.id==='miner'||f.def.id==='moss'){
      f.abilityCd=f.def.abilityCd;f.moveLock=0.3;f.patchCast=0.55;f.hitSet.clear();
      spell(f,f.def.id==='miner'?'quake':'grip');spawnAbilityRing(f);SFX.ability();return;
    }
    const x=f.pos.x,z=f.pos.z;base.useAbility(f);limit(f);
    if(f.def.id==='volt'){
      const s=spell(f,'arc');s.x=x;s.z=z;const l=Math.hypot(f.pos.x-x,f.pos.z-z)||1;s.dx=(f.pos.x-x)/l;s.dz=(f.pos.z-z)/l;
      s.length=l;
      s.mesh.children.forEach((m,i)=>{m.position.x=x+s.dx*(i+1)*l/8;m.position.z=z+s.dz*(i+1)*l/8;});
    }else if(f.def.id==='phantom'){
      const model=tailor(f.def),mesh=model.root;mesh.position.set(x,f.pos.y,z);mesh.rotation.y=f.facing;
      for(const m of model.mats){m.transparent=true;m.opacity=0.38;m.depthWrite=false;}
      const bats=[];
      for(let i=0;i<4;i++){
        const bat=new THREE.Group();for(const wing of [-1,1]){
          box(bat,.40,.13,.19,0x703858,wing*.17,0,0).rotation.z=wing*.4;
        }
        bats.push(bat);mesh.add(bat);
      }
      scene.add(mesh);state.spells.push({kind:'decoy',mesh,materials:model.mats,bats,baseY:f.pos.y,t:0});
    }
  };
  stepFighter=function(f,dt,c){
    if(state.enabled){
      if(f.state!=='active'){f.patchRoot=0;f.patchCast=0;}
      f.patchRoot=Math.max(0,(f.patchRoot||0)-dt);
      if(f.patchRoot>0&&f.onGround){c={...c,dirX:0,dirZ:0,dash:false};}
    }
    base.stepFighter(f,dt,c);
    if(state.enabled){bodyContact(f);limit(f);f.group.position.copy(f.pos);
      f.patchCast=Math.max(0,(f.patchCast||0)-dt);
      if(f.state==='active'&&f.patchCast>0){
        const t=1-f.patchCast/.55,m=f.model;
        if(f.def.id==='miner'){const lift=Math.min(1,t/.65),drop=clamp((t-.65)/.18,0,1);
          m.armR.rotation.x=-2.7*lift+2.9*drop;m.bodyPivot.rotation.y=.38*lift-.75*drop;m.bodyPivot.rotation.x=-.18*lift+.5*drop;
        }else{const reach=Math.sin(t*Math.PI);m.armR.rotation.x=m.armL.rotation.x=-1.7*reach;
          m.armR.rotation.z=-.62*reach;m.armL.rotation.z=.62*reach;m.bodyPivot.position.y-=.17*reach;}
      }
      if(f.state==='active'&&f.def.id==='volt'&&f.abilityActive==='flash'){f.model.bodyPivot.rotation.x=.42;f.model.armL.rotation.x=.9;f.model.armR.rotation.x=.9;}
      if(f.state==='active'&&f.def.id==='phantom'&&f.phaseT>0){const t=1-f.phaseT/PHASE_DURATION;f.model.bodyPivot.rotation.y=Math.sin(Math.PI*t)*1.6;f.model.armL.rotation.z=.65;f.model.armR.rotation.z=-.65;}
      if(f.model.cape){const speed=Math.hypot(f.vx,f.vz);f.model.cape.rotation.x=.12+Math.min(.8,speed*.045)+Math.sin(f.animT*1.2)*.055;}
    }
  };
  aiControl=function(f,dt){
    const c=base.aiControl(f,dt);if(!active()||f.state!=='active')return c;
    for(const p of state.pumpkins){
      const dx=p.x-f.pos.x,dz=p.z-f.pos.z,d=Math.hypot(dx,dz);
      if(p.phase==='rolling'&&p.owner!==f){
        const rx=f.pos.x-p.x,rz=f.pos.z-p.z,speed=Math.hypot(p.vx,p.vz)||1,t=clamp((rx*p.vx+rz*p.vz)/(speed*speed),0,0.65);
        if(p.t<2.6-CFG.botReact&&t>0.04&&Math.hypot(rx-p.vx*t,rz-p.vz*t)<2.4){
          const sign=(rx*(-p.vz)+rz*p.vx)>=0?1:-1;c.dirX=-p.vz/speed*sign;c.dirZ=p.vx/speed*sign;c.quick=false;c.heavy=false;
          if(f.onGround&&f.ai.jumpCd<=0){c.jumpPressed=true;f.ai.jumpCd=0.9;}return c;
        }
      }else if(p.phase==='ripe'&&d<4.1&&f.ai.target&&f.attackT<=0&&f.ai.atkCd<=0){
        const tx=f.ai.target.pos.x-p.x,tz=f.ai.target.pos.z-p.z,l=Math.hypot(tx,tz)||1;
        if((dx*tx+dz*tz)/(d*l||1)>0.75){f.facing=Math.atan2(dx,dz);c.heavy=true;c.quick=false;f.ai.atkCd=0.85+CFG.botSwingGap;}
      }
    }
    for(const s of state.spells){if(s.kind==='decoy'||s.owner===f||s.t<CFG.botReact||s.t>0.8||!inSpell(s,f))continue;
      if(f.onGround&&f.ai.jumpCd<=0){c.jumpPressed=true;f.ai.jumpCd=0.9;}
      c.dirX=s.kind==='grip'?(f.pos.x-s.x)/5:-s.dz;c.dirZ=s.kind==='grip'?(f.pos.z-s.z)/5:s.dx;
    }
    return c;
  };
  spawnPowerup=function(){
    if(!state.enabled){base.spawnPowerup();return;}
    const original=POWER_TYPES[randi(0,POWER_TYPES.length-1)], [name,,color]=harvestPickups[original.id];
    const t={...original,name,color},spots=[[-9,0],[9,0],[0,8],[0,-8]],sp=spots[randi(0,spots.length-1)];
    const y=1.4,g=PatchArt.pickup(t);g.position.set(sp[0],y,sp[1]);scene.add(g);
    powerups.push({type:t,pos:new THREE.Vector3(sp[0],y,sp[1]),mesh:g,life:26,spin:1});
  };
  applyPowerup=function(f,t){
    base.applyPowerup(f,t);
    if(!active())return;
    if(t.id==='spark'){
      let nearest=null,range=Infinity;
      for(const p of state.pumpkins){
        const d=Math.hypot(f.pos.x-p.homeX,f.pos.z-p.homeZ);
        if(p.phase==='growing'&&d<range){nearest=p;range=d;}
      }
      if(nearest){nearest.phase='ripe';nearest.x=nearest.homeX;nearest.z=nearest.homeZ;nearest.bump=1;
        impactRing(nearest.x,.4,nearest.z,t.color,1.3);burst(nearest.x,1,nearest.z,t.color,12,4,.36,.65);}
    }
    if(f.isPlayer)announce(t.name+' · '+harvestPickups[t.id][1],1.35,'small');
  };
  updateWorld=function(dt){
    const run=active(),slow=Game.hitStop>0?0.12:1;
    if(run&&Game.matchTime>dt)tick(dt*slow);
    base.updateWorld(dt);
    if(state.enabled)for(const f of fighters){limit(f);f.group.position.copy(f.pos);}
  };
  function previewHarvest(){
    for(const p of state.pumpkins){p.phase='ripe';p.t=0;p.x=p.homeX;p.z=p.homeZ;}
    posePumpkins();
  }
  return {state,reset,launch,segmentDistance,configure,previewHarvest};
})();
