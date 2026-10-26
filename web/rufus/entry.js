import {mountRufus} from './scene.js';
const stage=document.getElementById('stage');
// The build defines RUFUS_GLB_URL as a string only when it embedded a rigged GLB.
const options={modelUrl:typeof RUFUS_GLB_URL==='string'?RUFUS_GLB_URL:null};
let dispose=()=>{};
try{dispose=mountRufus(stage,undefined,options)}catch{stage?.removeAttribute('data-rufus-ready');stage?.querySelector('.rufus-canvas')?.remove()}
window.addEventListener('pagehide',()=>dispose());
// A BFCache return must recreate the disposed renderer.
window.addEventListener('pageshow',e=>{if(e.persisted){try{dispose=mountRufus(stage,undefined,options)}catch{stage?.removeAttribute('data-rufus-ready')}}});
