// Renderer-independent pose calculation. Time is seconds; audio is played PCM RMS.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function poseAt(time, {mouth = .16, speaking = false, listening = false, thinking = false, preview = false, reduced = false, gazeX = 0, gazeY = 0} = {}) {
  if (reduced) return {jaw:0,blink:0,tilt:0,yaw:0,pitch:0,breath:0,ear:0,paw:0,gazeX:0,gazeY:0,brow:0};
  const t = Math.max(0, Number(time) || 0);
  // Deterministic irregular blink intervals, with an occasional double blink.
  const cycle = t % 11.7;
  const pulse = center => Math.max(0, 1 - Math.abs(cycle - center) / .095);
  const blink = Math.max(pulse(2.9), pulse(7.8), pulse(8.12));
  const energy = speaking ? clamp(((Number(mouth) || .16) - .16) / 1.19, 0, 1) : 0;
  const jaw = preview ? .12 + .43 * Math.pow(Math.sin(t * 10), 2) : energy;
  return {jaw, blink, tilt: thinking ? -.13 : .035*Math.sin(t*.71)+(listening?.055:0),
    yaw: clamp(gazeX,-1,1)*.13 + .045*Math.sin(t*.43), pitch: .018*Math.sin(t*.8)+(speaking?.025*Math.sin(t*4):0),
    breath: .009*Math.sin(t*1.8), ear: .035*Math.sin(t*2.1)+(listening?.08:0),
    paw: (speaking||preview) ? .10+.09*Math.sin(t*2.6) : .025*Math.sin(t*.9),
    gazeX:clamp(gazeX,-1,1)*.045, gazeY:clamp(gazeY,-1,1)*.035,
    brow:thinking?.075:listening?.04:.012*Math.sin(t*.7)};
}
