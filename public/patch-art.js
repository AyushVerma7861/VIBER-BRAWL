/* Art for the Pumpkin Patch. Furniture and scenery use the same cuboid vocabulary
   as the fighters. Static scenery shares one instanced draw per palette colour. */
const PatchArt = (() => {
  function homestead(parent) {
    const palette = new Map(), unit = new THREE.BoxGeometry(1,1,1);
    const transform = new THREE.Object3D();
    function block(x,y,z,w,h,d,color,rz=0,ry=0) {
      transform.position.set(x,y,z); transform.scale.set(w,h,d);
      transform.rotation.set(0,ry,rz);transform.updateMatrix();
      if (!palette.has(color)) palette.set(color,[]);
      palette.get(color).push(transform.matrix.clone());
    }
    // Low fields remain below the suspended ring when the camera swings around.
    block(0,-6,0,460,3,460,0x53434e);
    // Vines spill over individual coping stones, entirely outside the playable lanes.
    for(const side of [-1,1]){
      for(let i=-3;i<=3;i++){
        const x=i*4.8+.7*side,z=17*side;
        for(let j=0;j<5;j++){
          const angle=j*.84+i,px=x+j*.39,pz=z+Math.sin(angle)*.27;
          block(px,1.02,pz,.58,.16,.19,0x536336,0,angle*.2);
          block(px+.14,1.12,pz+side*.26,.52,.17,.40,j%2?0x8caa51:0x698f48,.23,angle);
        }
        block(x+.9,.65,z+side*.52,.25,.73,.31,0x688845,.22);
        block(x+1.12,.42,z+side*.61,.46,.19,.42,0x8a9f4e,.26);
      }
      for(let j=-3;j<=3;j++){
        const x=side*22,z=j*2.85;
        block(x,1.04,z,.35,.2,1.72,0x627744,0,.18);
        block(x-.34,1.1,z+.44,.75,.24,.46,0x8ba04a,.14,.4);
        block(x+.28,.88,z-.4,.42,.5,.53,0x678643,.2);
      }
    }
    // A layered orchard breaks up the horizon beyond the close individual trees.
    for(let i=0;i<90;i++){
      const a=i*2.39996,r=75+i%7*3,x=Math.sin(a)*r,z=Math.cos(a)*r,h=5+(i%8);
      block(x,-3+h/2,z,1.9,h,1.7,0x443546);
      block(x,h-3,z,6+i%5,3+i%3,6,[0x5c4258,0x674857,0x73515a][i%3],.12*Math.sin(i),a);
      block(x+1,h-.9,z,4.8,2.8,4.6,0x685068,.13,a);
    }
    // Broken autumn leaves and tiny flecks of straw give the court a readable scale.
    for(let i=0;i<130;i++){
      const x=Math.sin(i*9.27)*17.6,z=Math.cos(i*6.91)*15.3;
      if(Math.abs(x)<11&&Math.abs(z)<9&&i%5)continue;
      block(x,.023,z,.13+(i%4)*.06,.025,.11+(i%3)*.05,[0xa95d31,0xc49551,0x915e42][i%3],0,i);
    }
    for(const side of [-1,1])for(let n=0;n<6;n++){
      const x=side*10+n*1.03-2.6,z=side*10+Math.sin(n*2)*.65;
      block(x,.68,z,.92,.65,.76,0xc66725,0,n);
      block(x,.99,z,.19,.28,.18,0x64703f);
      block(x+.43,.51,z+.24,.68,.13,.35,0x738443,.16,n);
    }
    for (let i=-6;i<=6;i++) {
      block(i*6,-4.4,-43,4.8,0.32,24,i%2?0x68504a:0x59414a);
      block(i*6,-4.4,42,4.8,0.32,22,i%2?0x5b5344:0x50463c);
      for (let j=0;j<3;j++) {
        const x=i*6+Math.sin(i*7+j)*1.6,z=-34-j*7;
        block(x,-3.8,z,1.7,1.2,1.5,0xb85524,0,i*0.24);
        block(x,-3,z,0.24,0.48,0.3,0x555536);
      }
    }
    // Fence posts with paired rails tie every side to the same farm.
    for(let i=-7;i<=7;i++) for(const side of [-1,1]) {
      block(i*4,-2.5,side*26,0.47,3.9,0.5,0x5c433d,0.07*Math.sin(i));
      if(i<7)for(const y of [-2.7,-1.5])block(i*4+2,y,side*26,4.15,0.27,0.23,0x956b49);
    }
    // The cider barn has a split roof, hayloft, X-braced doors and a lit gable.
    const bx=-24,bz=-41;
    block(bx,0,bz,13,8,10,0x803f3c);
    for(const sign of [-1,1]){
      block(bx+sign*3.3,5.6,bz,8.3,0.65,11.6,0x393449,-sign*0.48);
      block(bx+sign*1.8,-0.55,bz+5.1,3.4,6.3,0.3,0x513333);
      block(bx+sign*1.8,-0.55,bz+5.35,0.3,6.8,0.18,0xc59365,sign*0.45);
      block(bx+sign*4.8,1.4,bz+5.15,1.75,1.65,0.2,0xffbd5c);
    }
    block(bx,4.35,bz+4.8,2.2,1.75,0.6,0xffcb77);
    // Twisted trunks carry broad leaf masses, with bare forked tips at the skyline.
    for(let i=0;i<38;i++){
      const a=i*2.39996,r=40+(i%5)*5,x=Math.sin(a)*r,z=Math.cos(a)*r;
      if(Math.hypot(x-bx,z-bz)<11)continue;
      const h=5+i%5;block(x,-4+h/2,z,1.1,h,1.1,0x493747,0.09*Math.sin(i));
      for(const sign of [-1,1]){
        block(x+sign, h-5,z,0.58,3.6,0.65,0x503848,-sign*0.53);
        if(i%4){
          for(let k=0;k<5;k++){
            const ring=k*Math.PI*.5+a,rad=k===4?0:1.2;
            block(x+sign*1.5+Math.sin(ring)*rad,h-3.4+(k===4?1.35:0),z+Math.cos(ring)*rad,2.6,2.1,2.45,
              [0x885064,0xaa673e,0x754e62,0x985a46,0xb37347][(k+i)%5],.13*sign,ring);
          }
        }
      }
    }
    // Weathered crates and bound sheaves on raised ledges outside the curb.
    for(const [x,z] of [[-16,-19],[15,19],[-23,-6],[23,6]]){
      block(x,-0.75,z,5.6,1.3,3.8,0x776149);
      for(let j=0;j<3;j++){const px=x+j*1.25-1.3,y=j===2?1.6:0.55;
        block(px,y,z,2.1,1.25,1.4,0xbe904a);for(const s of [-1,1])block(px+s*0.7,y,z,0.15,1.31,1.46,0x725037);}
    }
    // Wind pump at the opposite skyline from the cider barn.
    for(const sign of [-1,1])block(23+sign*1.2,1.7,33,.55,13,.65,0x66534d,sign*.11);
    block(23,4.6,33,3.0,.35,.55,0xa37d54);
    const rotor=new THREE.Group();rotor.position.set(23,8,32);parent.add(rotor);
    const bladeMat=new THREE.MeshLambertMaterial({color:0xb89b76});
    for(let i=0;i<8;i++){
      const spoke=new THREE.Group();spoke.rotation.z=i*Math.PI/4;rotor.add(spoke);
      const blade=new THREE.Mesh(unit,bladeMat);blade.position.y=2.05;blade.scale.set(.68,2.6,.16);blade.rotation.z=-.13;spoke.add(blade);
    }
    for(const [color,matrices] of palette){
      const mesh=new THREE.InstancedMesh(unit,new THREE.MeshLambertMaterial({color}),matrices.length);
      matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.receiveShadow=true;parent.add(mesh);
    }
    const sky=new THREE.Mesh(new THREE.SphereGeometry(180,32,16),new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false, fog:false,
      vertexShader:'varying vec3 v; void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec3 v; void main(){float h=normalize(v).y;vec3 c=mix(vec3(.54,.32,.31),vec3(.20,.17,.31),smoothstep(-.13,.22,h));c=mix(c,vec3(.055,.075,.15),smoothstep(.18,.75,h));gl_FragColor=vec4(c,1.);}'
    }));sky.renderOrder=-100;parent.add(sky);
    const moon=new THREE.Mesh(new THREE.IcosahedronGeometry(7,1),new THREE.MeshBasicMaterial({color:0xffdb9d,fog:false}));
    moon.position.set(46,27,-89);parent.add(moon);
    return rotor;
  }

  function pickup(type) {
    const g=new THREE.Group(), materials=new Map();
    function piece(w,h,d,x,y,z,color,roll=0){
      if(!materials.has(color))materials.set(color,new THREE.MeshLambertMaterial({color,emissive:color,emissiveIntensity:0.18}));
      const m=mkBox(w,h,d,materials.get(color));m.position.set(x,y,z);m.rotation.z=roll;g.add(m);return m;
    }
    if(type.id==='spark'){ // Wrapped raspberry sweet, stripe and folded ends
      piece(1.05,.79,.74,0,0,0,0xf16083);piece(.3,.82,.79,0,0,0,0xffe7ad);
      for(const s of [-1,1])piece(.48,.49,.47,s*.76,0,0,0xf5b77c,s*.65);
    }else if(type.id==='power'){ // Corked, sloshing witch's draught
      piece(.88,.88,.76,0,-.15,0,0x9141a9);piece(.62,.22,.58,0,.39,0,0xdba7dd);
      piece(.34,.32,.36,0,.63,0,0x9a6439);piece(.49,.35,.05,0,-.17,.40,0xffd276);
    }else if(type.id==='shield'){ // Brass spirit lantern with a mint flame
      piece(.8,.87,.68,0,0,0,0x67efc2);
      for(const s of [-1,1]){piece(.12,.94,.76,s*.43,0,0,0x564153);piece(.97,.15,.82,0,s*.51,0,0x735137);}
      piece(.42,.25,.18,0,.69,0,0xc49452);
    }else{ // Pair of winged spectral boots
      for(const s of [-1,1]){piece(.42,.55,.44,s*.28,0,0,0xbc9cf4);piece(.48,.28,.78,s*.28,-.29,.12,0x56446e);
        piece(.25,.58,.13,s*.56,.13,-.1,0xebe3ff,-s*.52);}
    }
    return g;
  }
  function gardenSoil(){
    const tile=document.createElement('canvas');tile.width=tile.height=256;
    const pen=tile.getContext('2d');
    let seed=1871;
    function random(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;}
    pen.fillStyle='#f3e9df';pen.fillRect(0,0,256,256);
    for(let i=0;i<850;i++){
      const x=random()*256,y=random()*256;
      pen.fillStyle=i%4?'rgba(107,66,43,.09)':'rgba(255,245,201,.5)';
      pen.fillRect(x,y,1+random()*4,1+random()*2);
    }
    for(let i=0;i<12;i++){
      const x=random()*256,y=random()*256;
      pen.strokeStyle='rgba(124,83,66,.17)';pen.lineWidth=1.1;pen.beginPath();pen.moveTo(x,y);
      pen.lineTo(x+8,y-2);pen.lineTo(x+13,y);pen.stroke();
    }
    const texture=new THREE.CanvasTexture(tile);
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    return texture;
  }
  return {homestead,pickup,gardenSoil};
})();
