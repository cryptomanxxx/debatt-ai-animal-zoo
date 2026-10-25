import assert from 'node:assert/strict';
import {mountRufus} from '../web/rufus/scene.js';
class Element extends EventTarget {
  constructor(){super();this.attrs=new Map();this.children=[];this.style={getPropertyValue:()=>'.16'};this.classes=new Set(['stage','fox']);this.classList={contains:c=>this.classes.has(c)};this.clientWidth=390;this.clientHeight=390;}
  setAttribute(k,v){this.attrs.set(k,v)} removeAttribute(k){this.attrs.delete(k)}
  append(c){this.children.push(c);c.parent=this} remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
  getBoundingClientRect(){return {left:0,top:0,width:390,height:390}}
}
let frames=new Map(),next=0,observers=[];
class Observer{constructor(cb){this.cb=cb;this.disconnected=false;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}
const doc=new EventTarget();doc.hidden=false;doc.createElement=()=>new Element();doc.getElementById=()=>null;
const reduced=new EventTarget();reduced.matches=false;
globalThis.document=doc;globalThis.window={devicePixelRatio:3,matchMedia:()=>reduced};
globalThis.ResizeObserver=globalThis.MutationObserver=globalThis.IntersectionObserver=Observer;
globalThis.requestAnimationFrame=cb=>{frames.set(++next,cb);return next};globalThis.cancelAnimationFrame=id=>frames.delete(id);
function tick(t){const pending=[...frames.values()];frames.clear();pending.forEach(cb=>cb(t))}
let rendered=0,disposed=0,ratio=0,geometries=0,textures=0;
const renderer={setPixelRatio:r=>ratio=r,setSize(){},render(scene){rendered++;if(rendered===1){const gs=new Set(),ts=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)for(const value of Object.values(o.material))if(value?.isTexture)ts.add(value)});gs.forEach(g=>g.addEventListener('dispose',()=>geometries++));ts.forEach(t=>t.addEventListener('dispose',()=>textures++));}},dispose(){disposed++}};
const stage=new Element(),dispose=mountRufus(stage,()=>renderer);
assert.ok(stage.attrs.has('data-rufus-ready'));assert.equal(ratio,1.5);assert.equal(frames.size,1);
tick(100);assert.equal(frames.size,1);
// Reduced motion stops the continuous loop after rendering a static pose.
reduced.matches=true;reduced.dispatchEvent(new Event('change'));tick(140);assert.equal(frames.size,0);
reduced.matches=false;reduced.dispatchEvent(new Event('change'));assert.equal(frames.size,1);
// Switching to Doris and backgrounding release the scheduled frame.
stage.classes.delete('fox');observers[1].cb();assert.equal(frames.size,0);
stage.classes.add('fox');observers[1].cb();assert.equal(frames.size,1);
doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0);
doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,1);
observers[2].cb([{isIntersecting:false}]);assert.equal(frames.size,0);
observers[2].cb([{isIntersecting:true}]);assert.equal(frames.size,1);
const canvas=stage.children[0];canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));assert.equal(frames.size,0);assert.ok(!stage.attrs.has('data-rufus-ready'));
canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(frames.size,1);
dispose();dispose();assert.equal(frames.size,0);assert.equal(disposed,1);assert.equal(stage.children.length,0);assert.ok(observers.every(o=>o.disconnected));assert.ok(geometries>0);assert.equal(textures,1,'Shared coat texture disposed once');
// Both constructor and first-render failures leave the original SVG available.
const fallback=new Element();mountRufus(fallback,()=>{throw Error('WebGL unavailable')});assert.equal(fallback.children.length,0);assert.ok(!fallback.attrs.has('data-rufus-ready'));
const failed=new Element();mountRufus(failed,()=>({...renderer,render(){throw Error('GPU failure')}}));assert.equal(failed.children.length,0);assert.ok(!failed.attrs.has('data-rufus-ready'));assert.equal(frames.size,0);
assert.ok(observers.every(o=>o.disconnected));
doc.dispatchEvent(new Event('visibilitychange'));reduced.dispatchEvent(new Event('change'));assert.equal(frames.size,0,'Failed mounts cannot restart detached rendering');
const resizeFailed=new Element();mountRufus(resizeFailed,()=>({...renderer,setSize(){throw Error('Resize failure')}}));assert.equal(resizeFailed.children.length,0);assert.ok(observers.every(o=>o.disconnected));assert.equal(frames.size,0);
console.log('Rufus lifecycle: hidden/offscreen/Doris, reduced motion, context loss/restore, failed init and idempotent GPU disposal passed.');
