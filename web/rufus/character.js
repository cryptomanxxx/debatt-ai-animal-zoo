import * as T from 'three';

// A self-contained, articulated portrait. No downloaded model, CDN or asset keys.
export function createRufus() {
  const root = new T.Group(), head = new T.Group();
  const sphere = new T.SphereGeometry(1,32,24);
  const materials = {};
  for(const [name,color,roughness] of [
    ['fur',0xc85b20,.92],['gold',0xe4802e,.85],['cream',0xffdfab,.95],
    ['dark',0x39231e,.85],['nose',0x201b20,.27],['white',0xfff3d9,.26],
    ['iris',0x9b4916,.34],['pupil',0x080c10,.18],['mouth',0x371b24,.9],
    ['tongue',0xcb7175,.68],['ear',0xc88c75,.9]
  ]) materials[name] = new T.MeshStandardMaterial({color,roughness});
  // Fine combed coat relief, generated once; no texture download or canvas API.
  const pixels=new Uint8Array(256*256*4);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
    const grain=Math.sin(x*7.7+Math.sin(y*.12)*.7)*Math.sin(y*.57+x*2.1);
    const value=Math.round(210+grain*32),i=(y*256+x)*4;
    pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;
  }
  const coatTexture=new T.DataTexture(pixels,256,256);coatTexture.wrapS=coatTexture.wrapT=T.RepeatWrapping;
  coatTexture.repeat.set(3,2);coatTexture.needsUpdate=true;
  for(const key of ['fur','gold','cream','dark']){materials[key].map=coatTexture;materials[key].bumpMap=coatTexture;materials[key].bumpScale=.018;}
  const mesh = (parent,mat,p,s) => {
    const m = new T.Mesh(sphere,materials[mat]);m.position.set(...p);m.scale.set(...s);parent.add(m);return m;
  };
  // Tapered body, shoulders and cream bib; arms each have their own shoulder pivot.
  mesh(root,'fur',[0,.45,0],[.67,.99,.40]);
  mesh(root,'cream',[0,.55,.335],[.43,.79,.17]);
  mesh(root,'fur',[-.48,.85,0],[.31,.46,.35]);mesh(root,'fur',[.48,.85,0],[.31,.46,.35]);
  const arms=[];
  for(const side of [-1,1]) {
    const arm=new T.Group();arm.position.set(side*.55,.86,.08);root.add(arm);arms.push(arm);
    mesh(arm,'fur',[side*.10,-.28,.1],[.22,.44,.23]);
    const paw=mesh(arm,'dark',[side*.14,-.55,.33],[.23,.24,.19]);paw.rotation.z=side*.4;
    for(let i=0;i<3;i++)mesh(arm,'dark',[side*.14+(i-1)*.11,-.46,.46],[.075,.125,.085]);
    mesh(arm,'dark',[side*-.035,-.57,.44],[.095,.15,.10]);
    arm.rotation.x=-.43;arm.rotation.z=side<0?-.22:.48;
  }
  const tail=new T.Group();tail.position.set(-.68,.05,-.23);tail.rotation.z=.8;root.add(tail);
  const tailBody=mesh(tail,'fur',[0,.20,0],[.29,.66,.27]);
  const tip=mesh(tail,'cream',[0,.82,0],[.23,.35,.23]);
  head.position.set(0,1.47,.07);root.add(head);
  mesh(head,'fur',[0,.18,0],[.76,.70,.48]);
  // Wide cheek silhouette, a tapered forehead and layered cheek tufts.
  for(const side of [-1,1]) {
    mesh(head,'gold',[side*.52,-.10,.10],[.37,.40,.37]);
    const cheek=mesh(head,'cream',[side*.44,-.24,.35],[.40,.24,.26]);cheek.rotation.z=side*.26;
  }
  const ears=[];
  for(const side of [-1,1]) {
    const ear=new T.Group();ear.position.set(side*.48,.59,0);ear.rotation.z=-side*.30;ear.scale.y=.88;head.add(ear);ears.push(ear);
    // Curved triangular ear rather than cone primitives.
    const shape=new T.Shape();shape.moveTo(-.25,0);shape.bezierCurveTo(-.25,.23,-.12,.62,0,.81);shape.bezierCurveTo(.14,.64,.26,.25,.25,0);shape.quadraticCurveTo(0,-.09,-.25,0);
    const geo=new T.ExtrudeGeometry(shape,{depth:.105,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.055,bevelThickness:.055,curveSegments:12});
    const outer=new T.Mesh(geo,materials.dark);outer.position.z=-.07;ear.add(outer);
    const inner=new T.Mesh(geo,materials.cream);inner.scale.set(.76,.80,.60);inner.position.set(0,.045,.08);ear.add(inner);
    const center=new T.Mesh(geo,materials.ear);center.scale.set(.40,.62,.25);center.position.set(0,.065,.17);ear.add(center);
  }
  const lids=[],irises=[],brows=[];
  for(const side of [-1,1]) {
    const eye=new T.Group();eye.position.set(side*.30,.19,.414);eye.rotation.z=-side*.1;head.add(eye);
    mesh(eye,'dark',[0,0,0],[.253,.29,.15]);
    mesh(eye,'white',[0,0,.035],[.224,.256,.151]);
    const iris=new T.Group();iris.position.set(-side*.022,-.015,.158);eye.add(iris);irises.push(iris);
    mesh(iris,'iris',[0,0,0],[.143,.174,.052]);
    // Radial iris filaments and catchlights add depth without transparent layers.
    for(let i=0;i<24;i++) {
      const a=i*Math.PI/12;
      const strand=mesh(iris,i%3?'gold':'dark',[Math.cos(a)*.109,Math.sin(a)*.139,.040],[.006,.027,.004]);strand.rotation.z=a-Math.PI/2;
    }
    mesh(iris,'pupil',[0,0,.047],[.079,.111,.026]);
    mesh(iris,'white',[-.044,.060,.069],[.031,.037,.012]);
    mesh(iris,'white',[.037,-.046,.069],[.011,.014,.008]);
    // Eyelid shells cover the eye along an arc, not a flat rectangle.
    const lidGeo=new T.SphereGeometry(1,32,20,0,Math.PI*2,0,Math.PI/2);
    const lid=new T.Mesh(lidGeo,materials.fur);lid.scale.set(.258,.296,.27);lid.position.z=.012;lid.rotation.x=-1.48;eye.add(lid);lids.push(lid);
    const brow=mesh(head,'dark',[side*.30,.53,.38],[.23,.055,.07]);brow.rotation.z=-side*.12;brows.push(brow);
  }
  // Mouth interior is stationary; the lower jaw rotates from behind the muzzle.
  mesh(head,'mouth',[0,-.34,.47],[.28,.19,.17]);
  const jaw=new T.Group();jaw.position.set(0,-.30,.28);head.add(jaw);
  mesh(jaw,'cream',[0,-.12,.22],[.30,.125,.21]);
  mesh(jaw,'tongue',[0,-.065,.28],[.14,.025,.10]);
  for(const side of [-1,1])mesh(jaw,'white',[side*.17,-.037,.29],[.035,.040,.026]);
  // Muzzle lobes overlap the top of the mouth and remain fixed while speaking.
  for(const side of [-1,1])mesh(head,'cream',[side*.155,-.21,.57],[.24,.16,.21]);
  const nose=mesh(head,'nose',[0,-.105,.768],[.158,.104,.102]);nose.rotation.x=.2;
  mesh(head,'nose',[0,-.205,.747],[.014,.063,.015]);
  mesh(head,'white',[-.045,-.067,.854],[.047,.013,.005]);
  for(const side of [-1,1]) {
    for(let i=0;i<3;i++)mesh(head,'dark',[side*(.16+.055*(i%2)),-.18-.046*i,.76-i*.025],[.009,.009,.006]);
    const points=[];
    for(let i=0;i<3;i++) {
      points.push(side*.23,-.24-i*.035,.725,side*(.64+.04*i),-.18-i*.09,.61);
    }
    const whiskers=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(points,3)),new T.LineBasicMaterial({color:0x49332a,transparent:true,opacity:.6}));head.add(whiskers);
  }
  // Instanced tapered fur tufts follow the surface normals. Fixed seed, one draw
  // call per coat patch; thousands of tufts instead of thousands of objects.
  let seed=7341;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const tuftGeometry=new T.ConeGeometry(1,1,3,1);
  function coat(parent,center,radii,count,mat,length,accept=()=>true) {
    const fur=new T.InstancedMesh(tuftGeometry,materials[mat],count),dummy=new T.Object3D(),up=new T.Vector3(0,1,0),normal=new T.Vector3(),color=new T.Color();
    let placed=0;
    for(let i=0;i<count*12&&placed<count;i++){
      const y=random()*2-1,a=random()*Math.PI*2,r=Math.sqrt(1-y*y),x=r*Math.cos(a),z=r*Math.sin(a);
      if(!accept(x,y,z))continue;
      normal.set(x/radii[0],y/radii[1],z/radii[2]).normalize();
      // Fur grows outward and down, maintaining a soft combed silhouette.
      const dir=normal.clone().add(new T.Vector3(x*.18,-.36,0)).normalize();
      const len=length*(.6+random()*.65);
      dummy.position.set(center[0]+x*radii[0]+normal.x*len*.22,center[1]+y*radii[1]+normal.y*len*.22,center[2]+z*radii[2]+normal.z*len*.22);
      dummy.quaternion.setFromUnitVectors(up,dir);dummy.scale.set(len*.07,len,len*.045);dummy.updateMatrix();fur.setMatrixAt(placed,dummy.matrix);
      color.setHex(0xffffff).multiplyScalar(.75+random()*.35);fur.setColorAt(placed,color);placed++;
    }
    fur.count=placed;fur.instanceMatrix.needsUpdate=true;parent.add(fur);
  }
  coat(root,[0,.45,0],[.67,.99,.40],2600,'fur',.05,(_x,_y,z)=>z<.65);
  coat(root,[0,.55,.335],[.43,.79,.17],1300,'cream',.04,(_x,_y,z)=>z>0);
  coat(head,[0,.18,0],[.76,.70,.48],2200,'fur',.05,(x,y,z)=>z<.45||y>.55||Math.abs(x)>.85);
  for(const side of [-1,1]) {
    coat(head,[side*.52,-.10,.10],[.37,.40,.37],700,'gold',.07,(x,_y,z)=>side*x>0||z<0);
    coat(head,[side*.44,-.24,.35],[.40,.24,.26],650,'cream',.045,(x,_y,z)=>side*x>.15||z>.45);
  }
  coat(tail,[0,.20,0],[.29,.66,.27],500,'fur',.06);
  coat(tail,[0,.82,0],[.23,.35,.23],300,'cream',.05);
  // Crown quiff, swept to one side.
  for(let i=0;i<7;i++) {
    const tuft=mesh(head,'gold',[-.23+i*.062,.77+Math.sin(i*.5)*.035,.03],[.045,.12,.07]);tuft.rotation.z=-.5+i*.07;
  }
  return {root,apply(p){
    head.rotation.set(p.pitch,p.yaw,p.tilt-.07);root.scale.y=1+p.breath;
    jaw.rotation.x=.06+p.jaw*.42;jaw.position.y=-.32-p.jaw*.055;
    lids.forEach(l=>l.rotation.x=-1.48+p.blink*3.05);
    irises.forEach(i=>{i.position.x=(i.parent.position.x>0?-.022:.022)+p.gazeX;i.position.y=-.015+p.gazeY});
    brows.forEach((b,i)=>{b.position.y=.53+p.brow*(i?1:.55)});
    ears[0].rotation.z=.30+p.ear;ears[1].rotation.z=-.30-p.ear*.65;
    arms[0].rotation.x=-.43-p.paw;arms[1].rotation.x=-.43+p.paw*.5;
    tail.rotation.z=.8+p.breath*4;
  }};
}
