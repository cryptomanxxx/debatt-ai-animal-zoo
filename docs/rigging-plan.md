# Rufus GLB talking rig

`scripts/rig_rufus.py` turns the Tripo `cartoon fox 3d model.glb` into a rig that can talk. It needs Python 3 with numpy and Pillow (`pip install -r scripts/requirements-rig.txt`). Blender is not required.

## Why the source skeleton is discarded

The Tripo export only looks rigged:

- Its 55 `mixamorig:*` joints all sit at the origin, with no translation or rotation.
- The 3,520 bytes of inverse bind matrices contain the start of another GLB's header instead of matrices. Only the accessor's `min`/`max` values are plausible.
- 26,125 of 26,131 vertices are bound to `Hips`.
- There is no jaw, ear, tail or eye joint, no morph target and no animation.

Re-weighting that skeleton (the previous Blender plan) cannot produce a mouth. The tool therefore builds a new rig and records the source problems under `source_skin` in its report.

## What the tool produces

| Part | How |
|---|---|
| 19 joints: `Hips`, `Spine`, `Chest`, `Neck`, `Head`, `Ear.L.1/2`, `Ear.R.1/2`, `UpperArm/Forearm/Hand.L/R`, `Tail.1–4` | Positions come from `assets/rufus/rig.json` and are measured on the source (+Y up, Rufus faces +Z, his left is +X). |
| Skin weights | Distance-to-bone blending for the body. The head is rigid inside an ellipsoid. Ears and tail use masks along their axis, so legs and the head do not follow the tail. Each vertex keeps at most four influences. |
| `jawOpen` morph target | Rotates the lower jaw 18° about a hinge below the eyes. The jaw is everything below the mouth line, which is tilted along the head's roll. The model's mouth is already slightly open with a pink interior, so the opening shows tongue and mouth rather than a hole. |
| `eyeBlinkLeft`, `eyeBlinkRight` | Slide the painted upper lid region down over each eye. The eyes are texture, not geometry, so this reads as a blink at speed. It is not a sculpted eyelid. |
| Textures | Downscaled to 1024 px (`--max-texture`) and re-encoded. The unused `KHR_materials_volume` and `FB_ngon_encoding` extensions are dropped. Output is about 2.3 MB instead of 4.6 MB. |

Morph deltas are stored as sparse accessors. ARKit names are used so other tools recognise them.

## Audit: a rig that cannot talk is never written

Before writing anything the tool checks:

- The required joints exist.
- Weights are normalised.
- At most half the mesh is dominated by `Hips`.
- Head, ears, arms and tail each drive enough vertices.
- Every morph target moves enough vertices by a sane amount (`jawOpen`: at least 150 vertices, 8–60 mm).

On failure it prints `RUFUS_RIG_AUDIT=…` with the problems and exits non-zero. CI runs `scripts/test_rig_rufus.py` on a synthetic blob fox placed on the same landmarks, including cases where the jaw does not open or a tail joint is missing.

## Run locally (recommended)

```sh
cp "path/to/cartoon fox 3d model.glb" assets/rufus/source.glb
pip install -r scripts/requirements-rig.txt
npm run rig     # writes assets/rufus/rufus.glb and dist/rufus-rig-report.json
npm run build   # embeds the GLB in the Worker and serves it at /rufus.glb
npm run dev     # open / to see the rigged Rufus, /qa for synthetic speaking states
```

`assets/rufus/*.glb` is git-ignored because this repository is public. Check the Tripo licence before committing the source or the output; publishing requires `git add -f`. The manual **Actions → Rig Rufus GLB** workflow only works if `assets/rufus/source.glb` has been committed. It uploads the GLB and report as an artifact and deploys nothing.

## If the source model changes

The landmarks in `assets/rufus/rig.json` belong to this exact mesh. For a new export, re-measure them, for example from orthographic front and side renders with a coordinate grid. Then check the result in a viewer: weight colours, `jawOpen` = 1, both blinks = 1, and a pose with head, ears, tail and arms rotated.

## Known limits

- Mouth movement is still amplitude-driven: one `jawOpen` shape, no visemes. The next step would be extra shapes (`mouthFunnel`, `mouthClose`, `mouthSmile`) chosen from Gemini's output transcription.
- The blink compresses the painted eye. A dedicated eyelid mesh would look better close up.
- Legs are bound to `Hips` only; Rufus does not walk.
- The weights come from geometry, not an artist. Large rotations, especially at the shoulders, will show stretching. The runtime keeps rotations small.
