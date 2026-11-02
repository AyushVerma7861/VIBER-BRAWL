/* Midnight Mart: static environment art; gameplay and warning geometry are untouched. */
(() => {
  const world=new THREE.Group();world.name='Midnight Mart';scene.add(world);
  let seed=731;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  function texture(w,h,paint){const c=document.createElement('canvas');c.width=w;c.height=h;paint(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;}
  const asphalt=texture(1024,1024,(c,w,h)=>{
    c.fillStyle='#191823';c.fillRect(0,0,w,h);
    for(let i=0;i<110000;i++){const v=18+rand()*35;c.fillStyle=`rgba(${v},${v},${v+8},.4)`;c.fillRect(rand()*w,rand()*h,1+rand()*2,1);}
    for(let j=0;j<18;j++){let x=rand()*w,y=rand()*h;c.beginPath();c.moveTo(x,y);for(let k=0;k<9;k++){x+=(rand()-.5)*60;y+=rand()*28;c.lineTo(x,y);}c.strokeStyle='#080913';c.lineWidth=1;c.stroke();}
  });asphalt.wrapS=asphalt.wrapT=THREE.RepeatWrapping;asphalt.repeat.set(3,3);
  const roadMat=new THREE.MeshStandardMaterial({map:asphalt,roughness:.48,metalness:.12,color:0xBBB3D4,bumpMap:asphalt,bumpScale:.045});
  // Replace only the slab's material. Its height, collision and markings remain identical.
  const slab=arena.children.find(o=>o.isMesh&&o.geometry?.parameters?.width===46&&o.geometry?.parameters?.height===.6);
  if(slab) slab.material=roadMat;
  const brick=texture(1024,512,(c,w,h)=>{
    c.fillStyle='#171321';c.fillRect(0,0,w,h);
    for(let y=0,r=0;y<h;y+=32,r++)for(let x=-64;x<w;x+=128){let xx=x+(r%2?64:0),v=rand()*14;c.fillStyle=`rgb(${38+v},${27+v},${42+v})`;c.fillRect(xx+3,y+3,122,26);c.fillStyle='rgba(170,135,164,.12)';c.fillRect(xx+3,y+3,122,2);}
    for(let i=0;i<18000;i++){c.fillStyle=rand()>.5?'rgba(0,0,0,.14)':'rgba(200,160,190,.08)';c.fillRect(rand()*w,rand()*h,2,1);}
  });brick.wrapS=brick.wrapT=THREE.RepeatWrapping;brick.repeat.set(3,1);
  const brickMat=new THREE.MeshStandardMaterial({map:brick,roughness:.83,bumpMap:brick,bumpScale:.07});
  const woodMap=texture(256,128,(c,w,h)=>{c.fillStyle='#594032';c.fillRect(0,0,w,h);for(let i=0;i<120;i++){c.strokeStyle=`rgba(13,8,15,${rand()*.25})`;c.beginPath();c.moveTo(0,rand()*h);c.bezierCurveTo(80,rand()*h,160,rand()*h,w,rand()*h);c.stroke();}});
  const wood=new THREE.MeshStandardMaterial({map:woodMap,roughness:.9});
  const metal=new THREE.MeshStandardMaterial({color:0x171222,metalness:.55,roughness:.5});
  const violet=new THREE.MeshBasicMaterial({color:0x942FFF});
  const amber=new THREE.MeshBasicMaterial({color:0xFFAE50});
  const cube=new THREE.BoxGeometry(1,1,1);
  function box(x,y,z,w,h,d,material){const m=new THREE.Mesh(cube,material);m.position.set(x,y,z);m.scale.set(w,h,d);m.castShadow=true;m.receiveShadow=true;world.add(m);return m;}
  // A textured skin sits just behind the existing shop signs and original mural.
  box(0,5,-14.24,45.8,10,.08,brickMat);
  // The shutter remains as a central entrance; framed glowing side windows add depth.
  const windowMap=texture(512,512,(c,w,h)=>{
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#291725');g.addColorStop(.55,'#8d481f');g.addColorStop(1,'#352034');c.fillStyle=g;c.fillRect(0,0,w,h);
    for(let y=120;y<480;y+=100){c.fillStyle='#1e1420';c.fillRect(0,y+55,w,14);for(let x=20;x<480;x+=38){c.fillStyle=['#9a5b30','#cf9251','#402c37'][Math.floor(rand()*3)];c.fillRect(x,y+rand()*15,20,40);}}
    c.fillStyle='rgba(255,172,63,.14)';c.fillRect(0,0,w,h);c.fillStyle='#171221';c.fillRect(250,0,12,h);c.fillRect(0,260,w,12);
  });
  const glass=new THREE.MeshBasicMaterial({map:windowMap,color:0xE8A76B});
  for(const x of [-12,-2]){
    box(x,3.55,-13.75,4.25,5.3,.25,metal);box(x,3.55,-13.58,3.8,4.85,.05,glass);
    for(let j=0;j<2;j++){const b=box(x,2.2+j*2,-13.38,4.7,.45,.14,wood);b.rotation.z=(j?-.13:.14);}
  }
  // Layered canopy rather than a floating flat beam.
  const stripes=[],stripeMats=[new THREE.MeshStandardMaterial({color:0x251832,roughness:.8}),new THREE.MeshStandardMaterial({color:0x704165,roughness:.8})];
  for(let i=0;i<20;i++){const m=box(-14.6+i*.8,7.25,-12.8,.8,.14,3.4,stripeMats[i%2]);m.rotation.x=.14;stripes.push(m);box(-14.6+i*.8,6.85,-11.03,.8,.55,.09,stripeMats[i%2]);}
  box(-7,6.98,-11.1,16.3,.55,.12,metal);box(-7,7.63,-14,16.6,.16,.25,metal);
  box(-7,7.74,-13.82,16,.055,.07,violet);
  // Roof silhouettes and downpipe: details read against the moonlit sky.
  for(const x of [-16,-6,5,14]){box(x,10.9,-15.5,2.2,1.8,1.8,metal);for(let k=0;k<5;k++)box(x,10.35+k*.23,-14.57,1.8,.05,.05,wood);}
  for(const x of [-16,2])box(x,5,-13.9,.16,10,.16,metal);
  function signPlane(text,x,y,z,w,h,color){const t=texture(512,256,(c)=>{c.fillStyle='#0b0813';c.fillRect(0,0,512,256);c.strokeStyle=color;c.lineWidth=5;c.strokeRect(12,12,488,232);c.font='bold 110px monospace';c.textAlign='center';c.textBaseline='middle';c.shadowColor=color;c.shadowBlur=18;c.fillStyle=color;c.fillText(text,256,128);});const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t}));m.position.set(x,y,z);world.add(m);return m;}
  signPlane('OPEN',17.4,6.6,-13.85,4.8,2.2,'#f467ce').rotation.z=.08;
  signPlane('NO REFUNDS',-7,3.5,-13.6,3.2,1,'#f1b670');
  // Amber practicals, with soft light pools instead of a uniformly lit wall.
  for(const x of [-14,-.3,20]){box(x,6.3,-12.3,.7,.13,.7,metal);box(x,6.1,-12.3,.4,.3,.4,amber);}
  const key=new THREE.PointLight(0xFF9B43,2.3,24,1.5);key.position.set(-6,5,-10);world.add(key);
  const purple=new THREE.PointLight(0x9D43FF,1.3,28,2);purple.position.set(-8,8,-11);world.add(purple);
  arena.traverse(o=>{if(o.isAmbientLight)o.intensity=.30;if(o.isHemisphereLight)o.intensity=.65;if(o.isDirectionalLight){o.intensity=.65;o.color.setHex(0xA49DFF);}});
  scene.fog.color.setHex(0x100D25);
  // Puddle light is an art-directed, rippled reflection texture, not a mirror or extra render pass.
  function reflection(color){return texture(256,512,(c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,h/2);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);c.globalCompositeOperation='destination-out';for(let i=0;i<150;i++){c.fillStyle=`rgba(0,0,0,${.25+rand()*.7})`;c.fillRect(rand()*w,rand()*h,rand()*150,1+rand()*4);}});}
  const reflAmber=new THREE.MeshBasicMaterial({map:reflection('rgba(255,128,42,.24)'),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  const reflPurple=new THREE.MeshBasicMaterial({map:reflection('rgba(159,62,255,.21)'),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  for(const [x,z,w,h,am] of [[-11,-3,6,15,1],[-2,0,4,16,0],[16,1,4,14,1],[-16,12,5,7,0],[11,15,5,7,1]]){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),am?reflAmber:reflPurple);m.rotation.x=-Math.PI/2;m.position.set(x,.035,z);world.add(m);}
  // Moon and soft halo behind the skyline.
  const moonTex=texture(256,256,(c,w,h)=>{c.save();c.beginPath();c.arc(128,128,123,0,Math.PI*2);c.clip();const base=c.createRadialGradient(83,72,10,128,128,180);base.addColorStop(0,'#e5dcf6');base.addColorStop(1,'#8d85b5');c.fillStyle=base;c.fillRect(0,0,w,h);for(let i=0;i<260;i++){const x=rand()*w,y=rand()*h,r=2+rand()*23;const gr=c.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(52,44,93,.13)');gr.addColorStop(.6,'rgba(70,60,110,.07)');gr.addColorStop(1,'rgba(70,60,110,0)');c.fillStyle=gr;c.fillRect(x-r,y-r,r*2,r*2);}for(let i=0;i<15000;i++){c.fillStyle=rand()>.5?'rgba(255,255,255,.08)':'rgba(30,20,60,.08)';c.fillRect(rand()*w,rand()*h,1,1);}c.restore();});
  const moon=new THREE.Sprite(new THREE.SpriteMaterial({map:moonTex,transparent:true,fog:false}));moon.position.set(22,23,-42);moon.scale.set(17,17,1);world.add(moon);
  // Cobwebs are one line mesh, located up under the canopy.
  const web=[];for(const [x,y] of [[-14.5,6.8],[.3,6.8]]){for(let spoke=0;spoke<7;spoke++){const a=spoke*Math.PI/12;web.push(x,y,-11.05,x+Math.cos(a)*1.8,y-Math.sin(a)*1.8,-11.05);}for(let r=.4;r<1.9;r+=.4)for(let k=0;k<6;k++){const a=k*Math.PI/12,b=(k+1)*Math.PI/12;web.push(x+Math.cos(a)*r,y-Math.sin(a)*r,-11.05,x+Math.cos(b)*r,y-Math.sin(b)*r,-11.05);}}
  const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(web,3));world.add(new THREE.LineSegments(wg,new THREE.LineBasicMaterial({color:0xB8A5D3,transparent:true,opacity:.35})));
  // Leaf piles are instanced. No decoration is placed in the central combat circle.
  const leaves=new THREE.InstancedMesh(new THREE.PlaneGeometry(.22,.38),new THREE.MeshStandardMaterial({color:0x9E4B21,roughness:1,side:THREE.DoubleSide}),500);const d=new THREE.Object3D();
  for(let i=0;i<500;i++){const side=i%2?-1:1;d.position.set(side*(15+rand()*6),.045+rand()*.04,-11+rand()*31);d.rotation.set(-Math.PI/2,0,rand()*Math.PI*2);d.scale.setScalar(.7+rand()*1.2);d.updateMatrix();leaves.setMatrixAt(i,d.matrix);leaves.setColorAt(i,new THREE.Color().setHSL(.035+rand()*.08,.6,.18+rand()*.16));}world.add(leaves);
  // Utility cables give the roof a stronger outline without extra meshes per segment.
  const cablePts=[];for(const height of [11.9,12.6])for(let i=0;i<24;i++){const x=-24+i*2,xx=x+2;const y=v=>height-Math.sin((v+24)/48*Math.PI)*2; cablePts.push(x,y(x),-14,xx,y(xx),-14);}
  const cg=new THREE.BufferGeometry();cg.setAttribute('position',new THREE.Float32BufferAttribute(cablePts,3));world.add(new THREE.LineSegments(cg,new THREE.LineBasicMaterial({color:0x090710})));
  // Real 3D trees stand behind the shop, outside the entire camera envelope.
  // No billboards: branches and foliage retain their shape from every angle.
  const treeParts=[],leafParts=[];
  function branch(a,b,r1,r2){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const o=new THREE.Object3D();o.position.copy(start.add(end).multiplyScalar(.5));
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());
    o.scale.set(r1,delta.length(),r1);o.updateMatrix();treeParts.push(o.matrix.clone());
  }
  for(const side of [-1,1]){
    const x=side*25,z=-34;
    branch([x,0,z],[x+.6,10,z-.4],.65);
    branch([x+.6,10,z-.4],[x-.2,18,z],.32);
    for(let i=0;i<9;i++){
      const a=i*2.4,reach=3+rand()*2,height=10+i*.75;
      const tip=[x+Math.cos(a)*reach,height+3,z+Math.sin(a)*reach];
      branch([x+.4,height-2,z],tip,.16);
      const o=new THREE.Object3D();o.position.set(...tip);o.rotation.set(rand(),rand()*6,rand());
      o.scale.set(2+rand(),1.3+rand(),1.8+rand());o.updateMatrix();leafParts.push(o.matrix.clone());
    }
  }
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.55,1,1,7),new THREE.MeshStandardMaterial({color:0x3b2931,roughness:1}),treeParts.length);
  trunks.name='Midnight trees — 3D branches';treeParts.forEach((m,i)=>trunks.setMatrixAt(i,m));world.add(trunks);
  const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0xb26329,roughness:1}),leafParts.length);
  crowns.name='Midnight trees — 3D foliage';leafParts.forEach((m,i)=>{crowns.setMatrixAt(i,m);crowns.setColorAt(i,new THREE.Color().setHSL(.035+rand()*.055,.65,.25+rand()*.12));});world.add(crowns);
  // Lanterns remain at the sides of the forecourt.
  for(const side of [-1,1]){
    box(side*21.9,4.8,9,.17,9.6,.17,metal);
    box(side*21.9,9.55,9,1.1,.15,1.1,metal);box(side*21.9,8.95,9,.6,1,.6,amber);box(side*21.9,8.4,9,.85,.12,.85,metal);
  }
  // One alpha texture for all paper notices, with a hand-cut ghost silhouette.
  const poster=texture(256,384,(c)=>{c.fillStyle='#bd9267';c.fillRect(0,0,256,384);c.fillStyle='#35243c';c.fillRect(12,12,232,360);c.fillStyle='#dcc2a0';c.beginPath();c.arc(128,135,66,Math.PI,0);c.lineTo(194,270);c.lineTo(166,251);c.lineTo(139,275);c.lineTo(110,252);c.lineTo(84,273);c.lineTo(62,254);c.lineTo(62,135);c.fill();c.fillStyle='#35243c';for(const x of [105,150]){c.beginPath();c.ellipse(x,144,10,17,0,0,7);c.fill();}c.font='bold 23px monospace';c.textAlign='center';c.fillStyle='#ddae76';c.fillText('AFTER DARK',128,335);});
  const posterMat=new THREE.MeshStandardMaterial({map:poster,roughness:1});
  for(const [x,y,z] of [[-18,4,-14.1],[13,3.1,-14.1],[20,2.8,-14.1]]){const p=new THREE.Mesh(new THREE.PlaneGeometry(1.25,1.88),posterMat);p.position.set(x,y,z);p.rotation.z=(rand()-.5)*.18;world.add(p);}
  // A continuous neighbourhood anchors the combat forecourt to the city.
  // Everything here is scenery beyond the existing playable footprint.
  const pavement=new THREE.MeshStandardMaterial({color:0x494452,roughness:.95});
  const concrete=new THREE.MeshStandardMaterial({color:0x292636,roughness:.9});
  const masonry=new THREE.MeshStandardMaterial({map:brick,color:0x797084,roughness:.9});
  const darkGlass=new THREE.MeshStandardMaterial({color:0x101422,metalness:.25,roughness:.4});
  const litWindow=new THREE.MeshBasicMaterial({color:0x8b6043});
  const coolWindow=new THREE.MeshBasicMaterial({color:0x414467});
  const paint=new THREE.MeshStandardMaterial({color:0x938477,roughness:1});
  box(0,-.85,0,240,.4,240,roadMat);
  // Raised sidewalks meet the shop apron; the road crosses in front of it.
  for(const side of [-1,1]){
    box(side*32,-.36,0,18,.5,49,pavement);
    box(side*23.5,-.13,1,1,.32,46,concrete);
    for(let z=-20;z<24;z+=4)box(side*32,-.102,z,17,.012,.045,metal);
    for(let x=24;x<41;x+=4)box(side*x,-.102,1,.045,.012,46,metal);
  }
  box(0,-.39,25,84,.5,2,pavement);
  box(0,-.35,44,150,.6,8,pavement);
  // Lane dashes and a zebra crossing locate the arena on an actual street.
  for(let x=-100;x<101;x+=10)box(x,-.638,34,4,.012,.18,paint);
  for(let z=28;z<42;z+=2)box(-33,-.63,z,5,.015,.8,paint);
  // Solid volumes behind CHOG MART close the exposed rear and side walls.
  box(0,4.8,-21,46,9.6,13,brickMat);
  box(0,9.7,-21,47,.35,14,concrete);
  for(const side of [-1,1])for(let i=0;i<3;i++){
    const x=side*(35+i*17),z=-20-i*2,h=14+(i%2)*7;
    box(x,h/2-.1,z,15,h,20,masonry);
    box(x,h+.1,z,15.7,.45,20.7,concrete);
    box(x,3,-9.85-i*2,11,5.8,.2,metal);
    for(let y=7;y<h-1;y+=3.5)for(let dx=-4.5;dx<=4.5;dx+=3){
      box(x+dx,y,z+10.1,1.7,2.2,.12,darkGlass);
      if(rand()>.4)box(x+dx,y,z+10.18,1.35,1.85,.03,rand()>.5?litWindow:coolWindow);
    }
    box(x,6.1,z+11,12,.3,2.2,metal);
    box(x,h+1,z,3,2,3,metal);
  }
  signPlane('LAUNDRY',-35,5.1,-9.6,8,1.5,'#79a6b7');
  signPlane('ARCADE',35,5.1,-9.6,8,1.5,'#c878b7');
  // Across the road: buildings remain behind the player in normal combat views.
  for(let x=-65;x<=65;x+=18){
    const h=12+rand()*13;box(x,h/2,61,16,h,24,masonry);
    box(x,h+.2,61,16.5,.4,24.5,concrete);
    for(let y=5;y<h-2;y+=4)for(let dx=-5;dx<=5;dx+=5){
      box(x+dx,y,48.9,2,2.6,.12,rand()>.55?litWindow:darkGlass);
    }
  }
  // Street furniture sits outside the fight; warm pools help read depth at night.
  for(const x of [-55,-32,32,55]){
    box(x,4.6,44,.18,9.4,.18,metal);box(x,9.2,43,2,.15,2,metal);
    box(x,9.05,43,.9,.15,1.1,amber);
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(10,12),reflAmber);
    pool.rotation.x=-Math.PI/2;pool.position.set(x,-.035,43);world.add(pool);
    box(x,0,24,.2,1.4,.2,metal);
  }
  // Continuous low city silhouettes provide a horizon in every direction.
  for(let i=0;i<22;i++){
    const a=i/22*Math.PI*2,r=85+rand()*12,h=15+rand()*23;
    box(Math.cos(a)*r,h/2-1,Math.sin(a)*r,10+rand()*8,h,12,concrete);
  }
  // Batch all repeated static boxes by material, keeping draw calls bounded.
  const batches=new Map();for(const o of [...world.children])if(o.geometry===cube){if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push(o);}
  for(const [material,meshes] of batches){if(meshes.length<2)continue;const inst=new THREE.InstancedMesh(cube,material,meshes.length);meshes.forEach((m,i)=>{m.updateMatrix();inst.setMatrixAt(i,m.matrix);world.remove(m);});inst.castShadow=true;inst.receiveShadow=true;world.add(inst);}
  const style=document.createElement('style');style.textContent=`#scrStart .kicker{color:#edb177;letter-spacing:.23em}#scrStart h1{color:#fff1dc;text-shadow:0 0 36px #8134a859}#scrStart .panel,#scrPause .panel{border-color:#754c645c;background:linear-gradient(145deg,#17101ef2,#090713f2)}#btnStart{background:#efb46e;color:#241126;box-shadow:0 0 24px #d9893222}#btnStart:hover{background:#ffd49c}#btnStart:focus-visible{outline:3px solid #fff;outline-offset:4px}`;document.head.append(style);
  const kicker=document.querySelector('#scrStart .kicker');if(kicker)kicker.textContent='CHOG TRIALS · MIDNIGHT MART';
  window.MidnightMart={root:world,info:()=>({direction:'A — Midnight Mart',leaves:500,reflection:'painted light pools',gameplayChanges:false})};
})();
