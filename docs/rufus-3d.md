# Rufus 3D candidate

GitHub is the source of truth. The active Site remains version 8 until the owner approves a merge and deployment. This branch started at `4e53576`; `web/index.html` and `worker/index.js` were compared byte-for-byte with Site v8 source commit `cb83f07ab1d4901ec0a93141a453320751ab6c97`.

## Rendering choice

Three.js/WebGL2 renders an original, procedural articulated fox portrait. The model has separate head, eyelids, gaze, eyebrows, ears, jaw, paws and tail, with 9,600 instanced fur tufts, layered eyes, muzzle, whiskers, a forest set and warm rim lighting. This is a stylized interpretation of the supplied reference, not a reproduction of its film-quality groomed fur. A bespoke artist-authored GLB with facial morph targets is the appropriate next step for that level of fidelity. Three.js supports that path without replacing the conversation system.

- `web/rufus/character.js`: geometry and articulated rig.
- `web/rufus/motion.js`: deterministic pose calculation, separately tested.
- `web/rufus/scene.js`: lighting, camera, frame scheduling and lifecycle.
- `web/rufus/entry.js`: isolated startup and BFCache restoration.
- `web/rufus/glb.js`: maps the same pose onto the rigged GLB (`jawOpen` and blink morph targets; head, neck, ear, arm and tail joints).

### Rigged GLB (optional)

When `assets/rufus/rufus.glb` exists at build time (see `docs/rigging-plan.md`), `npm run build` embeds it in the Worker, serves it at `/rufus.glb` and bundles Three's `GLTFLoader`. The page first renders the procedural fox, loads the GLB, and swaps it in once it validates (`data-rufus-model="glb"` on the stage). A missing file, a failed download or a model without the talking joints or morph targets keeps the procedural fox. The build refuses models over 3 MB. Without the file, CI and the default build behave as before and `/rufus.glb` returns 404. The embedded model makes the Worker script about 3 MB larger; check the host's script size limit before deploying it.

The renderer reads the existing stage classes and `--mouth-open` written by the played-PCM analyser. It does not access the microphone, WebSocket, session tokens or API keys. It never connects an extra audio output. Mouth movement follows amplitude, **not phoneme-level lip synchronization**. The browser's demo voice uses a synthetic talking cycle because browser speech synthesis exposes no PCM stream.

## Mobile budgets and fallback

Target 30 fps; device pixel ratio capped at 1.5, reduced to 1 when rendering consistently exceeds 24 ms. No shadows, postprocessing, external font/texture/model requests or CDN dependency. Animation pauses offscreen, in background tabs, and when Doris is selected. Reduced motion produces a stationary pose. The original SVG remains until the first successful 3D render and returns after WebGL context loss or renderer failure. Context restoration resumes the 3D scene. Page exit disposes GPU resources; BFCache return rebuilds them.

The app is bundled locally with exact, locked dependencies into the existing Worker HTML. `npm ci`, `npm run build`, `npm test`; CI runs the same sequence. No deployment workflow was added. The server-side `GEMINI_API_KEY` configuration and all v8 conversation code remain unchanged.

## Verification limits

The cloud QA browser has WebGL disabled. Its original SVG fallback and character selection can be tested, but it cannot validate the GPU-rendered appearance, context restoration or real Android frame rate. A real-device visual and microphone check is required before approving deployment. Local QA does not use the production secret or create Gemini sessions. `npm run dev`, then `/qa`, provides 390 px / 768 px viewport fixtures and synthetic pose/context-loss controls. These are dev-server-only and are not included in the Worker.

The Node lifecycle test uses a renderer double to exercise frame cancellation, character switching, context events, initialization failure and geometry/texture disposal. It does not substitute for a real GPU test. Offline geometry rendering was used to correct tail-coat alignment and eyelid closure; its lighting/materials differ from Three.js.

Browser viewport QA: 390 px and 768 px fixtures were inspected. The phone test revealed intrinsic grid overflow; columns and grid children now shrink correctly (body scroll width equals client width).
