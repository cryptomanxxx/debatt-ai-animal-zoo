import assert from 'node:assert/strict';
import {poseAt} from '../web/rufus/motion.js';
import {createRufus} from '../web/rufus/character.js';
import * as T from 'three';

// Silence, interrupted playback and queued-but-not-playing PCM must close the jaw.
assert.equal(poseAt(1,{mouth:1.35}).jaw,0);
assert.equal(poseAt(1,{speaking:true,mouth:.16}).jaw,0);
assert.equal(poseAt(1,{speaking:true,mouth:1.35}).jaw,1);
assert.equal(poseAt(1,{speaking:true,mouth:99}).jaw,1);
assert.equal(poseAt(1,{speaking:false,mouth:1.35}).jaw,0);
assert.equal(poseAt(1,{speaking:true,mouth:'invalid'}).jaw,0);
assert.ok(poseAt(1,{preview:true}).jaw>0);
for(const t of [0,2.9,7.8,8.12,12345]) {
  const p=poseAt(t,{reduced:true,speaking:true,mouth:1.35,preview:true});
  assert.ok(Object.values(p).every(v=>v===0),'Reduced motion must be stationary');
}
assert.equal(poseAt(2.9).blink,1);
assert.equal(poseAt(3.2).blink,0);
assert.notEqual(poseAt(1,{thinking:true}).tilt,poseAt(1,{listening:true}).tilt);
const fox=createRufus();
let draws=0,instances=0;
fox.root.traverse(o=>{if(o.isMesh||o.isLine){draws++;assert.ok(o.geometry.attributes.position.count>0)}if(o.isInstancedMesh)instances+=o.count});
assert.ok(draws<160,`Draw budget exceeded: ${draws}`);
assert.ok(instances<12000,`Fur budget exceeded: ${instances}`);
// Exercise complete open/close/blink poses; every transform and bound must stay finite.
for(let i=0;i<120;i++){
  fox.apply(poseAt(i/10,{speaking:true,mouth:(i%10)/7,gazeX:1,gazeY:-1}));
  fox.root.updateMatrixWorld(true);
  fox.root.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
  const bounds=new T.Box3().setFromObject(fox.root);
  assert.ok(bounds.max.y<3.2&&bounds.min.y>-1,'Model must fit the portrait camera');
}
console.log(`Rufus: played-audio poses, reduced motion, blink, finite rig; ${draws} draw calls / ${instances} fur instances.`);
