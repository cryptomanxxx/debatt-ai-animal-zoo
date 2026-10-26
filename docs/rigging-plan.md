# Rufus GLB rig repair — experimental

This PR is a **candidate-generation tool**, not a deployment. It does not change the live Animal Zoo app, its version 8 speech features, or the existing procedural Three.js fox.

## Why

The original Tripo GLB has an armature (55 skin joints) and skinned geometry, but its weights are ineffective: 26,125 of 26,131 vertices are rigidly assigned to Hips. It contains no glTF animations or facial morph targets. Reusing the bones while recomputing weights is a reasonable first trial; it is **not** a guarantee of attractive deformation.

## Input

Upload the original `cartoon fox 3d model(1).glb` into the repository at `assets/rufus/source.glb` on this feature branch (GitHub: Add file → Upload files). Do not rename the file inside the workflow; the standardized path is intentional. The original is preserved verbatim. Ensure you have the right to publish the model in this public repository; if not, this workflow must be redesigned to use a private storage location.

The source model is deliberately not committed in this PR.

## Run

After the source has been added and the workflow is merged into the default branch (GitHub ordinarily only lists manual workflows on the default branch), open **Actions → Rig Rufus GLB (experimental) → Run workflow**.

The job installs Blender, imports the source GLB, removes ineffective weights, rebinds the existing skeleton with Blender's automatic bone-heat weights, checks that most vertices are weighted and that the hip does not dominate almost everything, and exports `rufus-rigged.glb` as the downloadable `rufus-rigged-candidate` artifact. It uploads no model to the deployed Site.

Blender's automatic weights can fail on intersecting, thin or non-manifold geometry. The job deliberately fails in that case instead of calling a broken GLB ready.

## Acceptance before integration

- Inspect head, shoulder, elbow, hip and knee deformation in a real 3D viewer.
- Verify that eyes, mouth, ears and tail do not stretch unnaturally.
- Compare material and texture appearance with the source.
- Verify load time, mobile GPU frame rate, and microphone/speech regression on an Android device.
- Only then open a separate integration PR. Any proper tail/ear/facial rigging and lip-sync is separate work.

No automation is claimed to have completed until a real run with the source GLB succeeds.
