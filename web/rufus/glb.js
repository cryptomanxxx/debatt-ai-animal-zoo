import * as T from 'three';

// Drives the rigged GLB from scripts/rig_rufus.py with the same pose as the procedural fox.
// The model is 1 m tall, faces +Z and stands at the origin; scale it into the forest set.
const SCALE=3.2,GROUND=-.57;
export const glbView={position:[0,1.8,4.9],target:[0,1.55,0],narrow:3.9};
export const MORPHS=['jawOpen','eyeBlinkLeft','eyeBlinkRight'];

export function createGlbRufus(gltf) {
  const model=gltf.scene,root=new T.Group();
  model.scale.setScalar(SCALE);model.position.y=GROUND;root.add(model);
  const bone=name=>{
    const o=model.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));
    if(!o)throw Error('Rufus GLB lacks joint '+name);return o;
  };
  const [head,neck,chest,earL,earR,armL,armR,foreL,foreR]=['Head','Neck','Chest','Ear.L.1','Ear.R.1','UpperArm.L','UpperArm.R','Forearm.L','Forearm.R'].map(bone);
  const ear2=[bone('Ear.L.2'),bone('Ear.R.2')],tail=[1,2,3,4].map(i=>bone('Tail.'+i));
  let face=null;
  model.traverse(o=>{if(o.isSkinnedMesh){o.frustumCulled=false;if(MORPHS.every(m=>o.morphTargetDictionary?.[m]!==undefined))face=o}});
  if(!face)throw Error('Rufus GLB lacks face morph targets');
  const [jaw,blinkL,blinkR]=MORPHS.map(m=>face.morphTargetDictionary[m]);
  return {root,view:glbView,apply(p){
    // Neck carries part of the head turn so the fur at the throat does not shear.
    neck.rotation.set(p.pitch*.4,p.yaw*.35,p.tilt*.3);
    head.rotation.set(p.pitch*.6-p.gazeY,p.yaw*.65+p.gazeX,p.tilt*.7);
    chest.rotation.x=-p.breath*2;
    earL.rotation.z=-p.ear*2.4;earR.rotation.z=p.ear*2.4;
    ear2[0].rotation.z=-p.ear*1.2;ear2[1].rotation.z=p.ear*1.2;
    // The source pose holds both arms out level; lower them, then gesture forward while talking.
    armL.rotation.set(-p.paw*1.1,0,-.42);armR.rotation.set(-p.paw*.6,0,.42);
    foreL.rotation.y=-p.paw*.8;foreR.rotation.y=p.paw*.4;
    tail.forEach((t,i)=>{t.rotation.y=p.tail*(.6+i*.25);t.rotation.z=p.breath*3});
    face.morphTargetInfluences[jaw]=Math.min(1,p.jaw*.9);
    face.morphTargetInfluences[blinkL]=face.morphTargetInfluences[blinkR]=p.blink;
  }};
}
