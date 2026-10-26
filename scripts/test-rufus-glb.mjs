import assert from 'node:assert/strict';
import * as T from 'three';
import {createGlbRufus,MORPHS} from '../web/rufus/glb.js';
import {poseAt} from '../web/rufus/motion.js';
import {mountRufus} from '../web/rufus/scene.js';

const JOINTS=['Hips','Spine','Chest','Neck','Head','Ear.L.1','Ear.L.2','Ear.R.1','Ear.R.2','UpperArm.L','Forearm.L','Hand.L','UpperArm.R','Forearm.R','Hand.R','Tail.1','Tail.2','Tail.3','Tail.4'];
// A stand-in for what GLTFLoader returns for scripts/rig_rufus.py output.
function fakeGltf({joints=JOINTS,morphs=MORPHS}={}) {
  const scene=new T.Group(),bones=joints.map(name=>{const b=new T.Bone();b.name=T.PropertyBinding.sanitizeNodeName(name);return b});
  bones.slice(1).forEach(b=>bones[0].add(b));
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,0,1,0,1,0,0],3));
  geometry.morphAttributes.position=morphs.map(name=>{const a=new T.Float32BufferAttribute(new Float32Array(9),3);a.name=name;return a});
  const texture=new T.Texture(),mesh=new T.SkinnedMesh(geometry,new T.MeshStandardMaterial({map:texture}));
  mesh.add(bones[0]);mesh.bind(new T.Skeleton(bones));scene.add(mesh);
  return {scene,mesh,texture,bone:name=>scene.getObjectByName(T.PropertyBinding.sanitizeNodeName(name))};
}

// Pose mapping: played audio opens the jaw morph, blinks close both eyes, idle sways ears and tail.
const gltf=fakeGltf(),rufus=createGlbRufus(gltf),influence=name=>gltf.mesh.morphTargetInfluences[gltf.mesh.morphTargetDictionary[name]];
rufus.apply(poseAt(1,{speaking:true,mouth:1.35}));
assert.ok(influence('jawOpen')>.8&&influence('jawOpen')<=1);
assert.ok(gltf.bone('UpperArm.L').rotation.x<0,'Paws gesture while talking');
rufus.apply(poseAt(1,{speaking:true,mouth:.16}));
assert.equal(influence('jawOpen'),0,'Silence closes the jaw');
rufus.apply(poseAt(2.9));
assert.equal(influence('eyeBlinkLeft'),1);assert.equal(influence('eyeBlinkRight'),1);
rufus.apply(poseAt(4,{listening:true}));
assert.ok(gltf.bone('Ear.L.1').rotation.z<0&&gltf.bone('Ear.R.1').rotation.z>0,'Ears turn outward while listening');
assert.notEqual(gltf.bone('Tail.4').rotation.y,0);
rufus.apply(poseAt(4,{reduced:true,speaking:true,mouth:1.35}));
assert.equal(influence('jawOpen'),0);assert.equal(gltf.bone('Tail.4').rotation.y,0);assert.equal(gltf.bone('Head').rotation.y,0);
assert.equal(gltf.mesh.frustumCulled,false);
// Models without the talking rig are rejected, so the procedural fox stays.
assert.throws(()=>createGlbRufus(fakeGltf({joints:JOINTS.filter(j=>j!=='Ear.R.1')})),/Ear\.R\.1/);
assert.throws(()=>createGlbRufus(fakeGltf({morphs:['jawOpen']})),/morph targets/);

// Scene upgrade: procedural fox first, GLB once loaded, every GPU resource released on exit.
class Element extends EventTarget {
  constructor(){super();this.attrs=new Map();this.children=[];this.style={getPropertyValue:()=>'.16'};this.classList={contains:c=>c==='fox'};this.clientWidth=390;this.clientHeight=600;}
  setAttribute(k,v){this.attrs.set(k,v)} removeAttribute(k){this.attrs.delete(k)} getAttribute(k){return this.attrs.get(k)}
  append(c){this.children.push(c);c.parent=this} remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
  getBoundingClientRect(){return {left:0,top:0,width:390,height:600}}
}
class Observer{observe(){}disconnect(){}}
const doc=new EventTarget();doc.hidden=false;doc.createElement=()=>new Element();doc.getElementById=()=>null;
const reduced=new EventTarget();reduced.matches=false;
globalThis.document=doc;globalThis.window={devicePixelRatio:1,matchMedia:()=>reduced};
globalThis.ResizeObserver=globalThis.MutationObserver=globalThis.IntersectionObserver=Observer;
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function renderer(){
  const r={scenes:[],setPixelRatio(){},setSize(){},render(scene){r.scenes.push(scene)},dispose(){}};return r;
}
const disposed=object=>{let count=0;object.traverse(o=>o.geometry?.addEventListener('dispose',()=>count++));return ()=>count};

const model=fakeGltf(),stage=new Element(),gpu=renderer();let requested;
const exit=mountRufus(stage,()=>gpu,{modelUrl:'/rufus.glb',loadModel:async url=>{requested=url;return model}});
assert.ok(stage.attrs.has('data-rufus-ready'),'Procedural fox renders before the model arrives');
const scene=gpu.scenes[0],procedural=scene.children.find(o=>o.isGroup&&!o.isScene&&o!==model.scene);
const proceduralDisposed=disposed(procedural);
await settle();
assert.equal(requested,'/rufus.glb');
assert.equal(stage.getAttribute('data-rufus-model'),'glb');
assert.ok(proceduralDisposed()>0,'Procedural fox is released after the swap');
let glbGeometryDisposed=0,textureDisposed=0,skeletonDisposed=0;
model.mesh.geometry.addEventListener('dispose',()=>glbGeometryDisposed++);model.texture.addEventListener('dispose',()=>textureDisposed++);
const skeletonDispose=model.mesh.skeleton.dispose.bind(model.mesh.skeleton);model.mesh.skeleton.dispose=()=>{skeletonDisposed++;skeletonDispose()};
exit();
assert.equal(glbGeometryDisposed,1);assert.equal(textureDisposed,1);assert.equal(skeletonDisposed,1);

// A failed or unusable download keeps the procedural fox; a late download after exit is discarded.
const failing=new Element();mountRufus(failing,renderer,{modelUrl:'/rufus.glb',loadModel:async()=>{throw Error('404')}});
await settle();assert.ok(failing.attrs.has('data-rufus-ready'));assert.ok(!failing.attrs.has('data-rufus-model'));
const broken=new Element();mountRufus(broken,renderer,{modelUrl:'/rufus.glb',loadModel:async()=>fakeGltf({morphs:[]})});
await settle();assert.ok(!broken.attrs.has('data-rufus-model'));
let release;const late=fakeGltf(),lateStage=new Element();let lateDisposed=0;late.mesh.geometry.addEventListener('dispose',()=>lateDisposed++);
const lateExit=mountRufus(lateStage,renderer,{modelUrl:'/rufus.glb',loadModel:()=>new Promise(r=>release=r)});
await settle();lateExit();release(late);await settle();
assert.equal(lateDisposed,1);assert.ok(!lateStage.attrs.has('data-rufus-model'));
// Without a model URL nothing is requested.
let called=false;mountRufus(new Element(),renderer,{loadModel:async()=>{called=true}});await settle();assert.equal(called,false);
console.log('Rufus GLB: jaw/blink morphs, ears, tail, gestures, joint validation, model swap and disposal passed.');
