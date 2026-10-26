"""Repair a pre-existing GLB armature by recomputing mesh skin weights.

Run via: blender -b -t 2 --python scripts/rig_rufus.py -- INPUT.glb OUTPUT.glb
The source asset is never overwritten. Failure is fatal, not a silent pass.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy


def parse_args():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    return parser.parse_args(arguments)


def assert_skin(mesh):
    counts = {}
    assigned = 0
    for vertex in mesh.data.vertices:
        weighted = [g for g in vertex.groups if g.weight > 0.001]
        if weighted:
            assigned += 1
        for group in weighted:
            name = mesh.vertex_groups[group.group].name
            counts[name] = counts.get(name, 0) + 1
    n = len(mesh.data.vertices)
    hip_dominant = sum(1 for vertex in mesh.data.vertices if vertex.groups and\n                       mesh.vertex_groups[max(vertex.groups, key=lambda g: g.weight).group].name.endswith("Hips"))
    meaningful = [name for name, value in counts.items() if value >= max(10, n * 0.005)]
    summary = {
        "vertices": n,
        "vertices_with_weights": assigned,
        "meaningfully_weighted_bones": meaningful,
        "hip_dominant_fraction": round(hip_dominant / max(n, 1), 4),
    }
    print("RUFUS_RIG_AUDIT=" + json.dumps(summary, sort_keys=True))
    if not n or assigned < n * 0.98:
        raise RuntimeError("Too many unweighted vertices after automatic skinning")
    if len(meaningful) < 5 or hip_dominant > n * 0.95:
        raise RuntimeError("Rig remains effectively bound to hips; manual inspection required")


def main():
    args = parse_args()
    if not args.source.is_file():
        raise FileNotFoundError(f"Missing source GLB: {args.source}")
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(armatures) != 1 or len(meshes) != 1:
        raise RuntimeError(f"Expected 1 armature and 1 mesh; got {len(armatures)} armatures, {len(meshes)} meshes")
    armature, mesh = armatures[0], meshes[0]
    if len(armature.data.bones) < 20:
        raise RuntimeError("Imported source skeleton has too few bones")
    original_world = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = original_world
    for modifier in list(mesh.modifiers):
        if modifier.type == "ARMATURE":
            mesh.modifiers.remove(modifier)
    mesh.vertex_groups.clear()
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO", keep_transform=True)
    assert_skin(mesh)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(args.destination.resolve()),
        export_format="GLB",
        export_apply=False,
        export_animations=False,
    )
    if not args.destination.is_file() or args.destination.stat().st_size < 100_000:
        raise RuntimeError("GLB export missing or unexpectedly small")
    print(f"Exported repaired candidate: {args.destination}")


if __name__ == "__main__":
    main()
