import {mountRufus} from './scene.js';
const stage=document.getElementById('stage');
let dispose=()=>{};
try{dispose=mountRufus(stage)}catch{stage?.removeAttribute('data-rufus-ready');stage?.querySelector('.rufus-canvas')?.remove()}
window.addEventListener('pagehide',()=>dispose());
// A BFCache return must recreate the disposed renderer.
window.addEventListener('pageshow',e=>{if(e.persisted){try{dispose=mountRufus(stage)}catch{stage?.removeAttribute('data-rufus-ready')}}});
