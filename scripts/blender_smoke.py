"""Headless Blender GLB smoke test. Uses a synthetic fox-like test mesh, never a private asset.

Checks that Blender can export/import an animated-shape-key GLB in GitHub Actions.
Later stages must obtain Rufus' original only through an owner-authorized private route.
"""
import json
import sys
from pathlib import Path

import bpy


def argument(name, default):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if name not in args:
        return default
    return args[args.index(name) + 1]


output = Path(argument("--output", "dist/blender-smoke"))
output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16)
mesh = bpy.context.object
mesh.name = "SyntheticTestMesh_NotRufus"
base = mesh.shape_key_add(name="Basis")
jaw = mesh.shape_key_add(name="jawOpen")
for vertex in jaw.data:
    if vertex.co.z < -0.2:
        vertex.co.z -= 0.03
mat = bpy.data.materials.new("SyntheticOrange")
mat.diffuse_color = (0.85, 0.25, 0.08, 1)
mesh.data.materials.append(mat)

candidate = output / "synthetic-test.glb"
bpy.ops.export_scene.gltf(filepath=str(candidate), export_format="GLB", export_morph=True)
assert candidate.is_file() and candidate.stat().st_size > 1000

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(candidate))
meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
assert len(meshes) == 1, "Roundtrip lost test mesh"
keys = meshes[0].data.shape_keys
assert keys and "jawOpen" in keys.key_blocks, "Roundtrip lost jawOpen"
report = {
    "status": "passed",
    "blender_version": bpy.app.version_string,
    "source": "synthetic-only",
    "mesh_count": len(meshes),
    "morph_targets": [key.name for key in keys.key_blocks],
    "private_model_access": "not configured",
}
(output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print("Blender synthetic GLB roundtrip PASSED:", report)
