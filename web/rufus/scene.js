import * as T from 'three';
import {createRufus} from './character.js';
import {poseAt} from './motion.js';

export function mountRufus(stage, rendererFactory = options => new T.WebGLRenderer(options)) {
  const canvas=document.createElement('canvas');canvas.className='rufus-canvas';
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Rufus, en animerad 3D-räv i en skogsglänta');
  let renderer;
  try{renderer=rendererFactory({canvas,alpha:false,antialias:false,powerPreference:'low-power'});}catch{return ()=>{}}
  const scene=new T.Scene();scene.background=new T.Color(0x10282b);scene.fog=new T.FogExp2(0x10282b,.085);
  const camera=new T.PerspectiveCamera(35,1,.1,35);camera.position.set(0,1.45,6.1);camera.lookAt(0,1.18,0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  scene.add(new T.HemisphereLight(0xc8e9ff,0x463121,2.1));
  const light=(color,intensity,p)=>{const l=new T.DirectionalLight(color,intensity);l.position.set(...p);scene.add(l)};
  light(0xffd6a0,3.0,[-3,4,4]);light(0xffa03d,3.3,[2,3,-2]);light(0xa3deff,.65,[3,1,3]);
  const fox=createRufus();scene.add(fox.root);
  // Low-cost forest set: trunks, canopy, mossy rocks, water and luminous motes.
  const trunkMat=new T.MeshStandardMaterial({color:0x293b35,roughness:1});
  const foliageMat=new T.MeshStandardMaterial({color:0x244f3c,roughness:1});
  const trunkGeo=new T.CylinderGeometry(.12,.22,7,7);
  const rockGeo=new T.IcosahedronGeometry(1,1);
  for(let i=0;i<16;i++) {
    const x=(i%2?-1:1)*(1.25+(i%5)*.65),z=-1.3-Math.floor(i/4)*1.15;
    const trunk=new T.Mesh(trunkGeo,trunkMat);trunk.position.set(x,1.6,z);trunk.rotation.z=Math.sin(i*4)*.12;scene.add(trunk);
    const crown=new T.Mesh(rockGeo,foliageMat);crown.position.set(x,3.2+(i%3)*.4,z);crown.scale.set(1.1,.8,.9);scene.add(crown);
    const rock=new T.Mesh(rockGeo,foliageMat);rock.position.set(x,-.58,z+.2);rock.scale.set(.7,.23,.48);scene.add(rock);
  }
  const ground=new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:0x16352c,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.57;scene.add(ground);
  const pond=new T.Mesh(new T.CircleGeometry(1,40),new T.MeshStandardMaterial({color:0x3c7477,metalness:.5,roughness:.24}));pond.rotation.x=-Math.PI/2;pond.position.set(.8,-.56,-2.4);pond.scale.set(1.3,3,1);scene.add(pond);
  const motes=new T.Group(),glowGeo=new T.SphereGeometry(.022,6,6),glowMat=new T.MeshBasicMaterial({color:0xffd478});
  for(let i=0;i<27;i++){const m=new T.Mesh(glowGeo,glowMat);m.position.set(Math.sin(i*7.13)*3,.2+(i%8)*.42,-.8-(i%5)*.65);motes.add(m)}scene.add(motes);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,disposed=false,lost=false,visible=true,last=0,elapsed=0,gazeX=0,gazeY=0,slowFrames=0,quality=1.5;
  function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;
    // Keep ears and shoulders in frame even on narrow phones.
    camera.position.z=Math.max(6.1,4.6/camera.aspect);camera.updateProjectionMatrix();}
  function active(){return !disposed&&!lost&&!document.hidden&&visible&&stage.classList.contains('fox')}
  function stop(){cancelAnimationFrame(frame);frame=0;last=0}
  function start(){if(active()&&!frame)frame=requestAnimationFrame(draw)}
  function draw(now){
    frame=0;if(!active())return;
    if(last&&now-last<32){frame=requestAnimationFrame(draw);return}
    const delta=last?Math.min((now-last)/1000,.1):0;last=now;elapsed+=delta;
    const speaking=stage.classList.contains('is-speaking');
    const pose=poseAt(elapsed,{mouth:stage.style.getPropertyValue('--mouth-open'),speaking,
      listening:stage.classList.contains('is-listening')||document.getElementById('recognize-speech')?.textContent.includes('Avsluta inspelning'),
      thinking:stage.classList.contains('is-thinking'),preview:stage.classList.contains('is-previewing'),reduced:reduced.matches,gazeX,gazeY});
    fox.apply(pose);if(!reduced.matches)motes.position.y=Math.sin(elapsed*.5)*.06;
    const before=performance.now();
    try{renderer.render(scene,camera);}catch{lost=true;stage.removeAttribute('data-rufus-ready');stop();return}
    if(performance.now()-before>24)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>15&&quality>1){quality=1;renderer.setPixelRatio(1);resize()}
    if(!reduced.matches)frame=requestAnimationFrame(draw);
  }
  function sync(){if(active())start();else stop()}
  function pointer(e){const r=stage.getBoundingClientRect();gazeX=(e.clientX-r.left)/r.width*2-1;gazeY=1-(e.clientY-r.top)/r.height*2;start()}
  function leave(){gazeX=0;gazeY=0;start()}
  function contextLost(e){e.preventDefault();lost=true;stage.removeAttribute('data-rufus-ready');stop()}
  function contextRestored(){lost=false;resize();stage.setAttribute('data-rufus-ready','');start()}
  const sizeObserver=new ResizeObserver(()=>{resize();start()});sizeObserver.observe(stage);
  const stateObserver=new MutationObserver(sync);stateObserver.observe(stage,{attributes:true,attributeFilter:['class']});
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync()});intersection.observe(stage);
  document.addEventListener('visibilitychange',sync);stage.addEventListener('pointermove',pointer,{passive:true});stage.addEventListener('pointerleave',leave);
  canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);reduced.addEventListener('change',sync);
  function dispose(){
    if(disposed)return;disposed=true;stop();sizeObserver.disconnect();stateObserver.disconnect();intersection.disconnect();
    document.removeEventListener('visibilitychange',sync);stage.removeEventListener('pointermove',pointer);stage.removeEventListener('pointerleave',leave);
    canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);reduced.removeEventListener('change',sync);
    const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m))});
    geometries.forEach(g=>g.dispose());const textures=new Set();materials.forEach(m=>{for(const v of Object.values(m))if(v?.isTexture)textures.add(v);m.dispose()});textures.forEach(t=>t.dispose());renderer.dispose();canvas.remove();stage.removeAttribute('data-rufus-ready');
  }
  try { stage.append(canvas);resize();renderer.render(scene,camera);stage.setAttribute('data-rufus-ready','');start(); }
  catch { dispose(); }
  return dispose;
}

