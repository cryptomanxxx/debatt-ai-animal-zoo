"""Rebuild Rufus' GLB as a talking rig: new skeleton, skin weights and face morph targets.

Run: python3 scripts/rig_rufus.py SOURCE.glb OUTPUT.glb [--config assets/rufus/rig.json]

The Tripo source ships a Mixamo-named skeleton that cannot be repaired: every joint
sits at the origin, the inverse bind matrices are overwritten with unrelated bytes and
26,125 of 26,131 vertices are bound to Hips. It has no jaw, ear or tail joints and no
morph targets. This tool therefore discards that skin and builds a new one from the
landmarks in the config file:

- joints for hips, spine, chest, neck, head, two per ear, four in the tail and arms;
- skin weights from distance-to-bone blending, with masked ear, tail and head regions;
- morph targets jawOpen, eyeBlinkLeft and eyeBlinkRight (ARKit names);
- textures downscaled and re-encoded so the asset suits mobile.

The source file is never modified. The audit fails loudly instead of exporting a rig
that cannot talk. Requires numpy and Pillow only (see scripts/requirements-rig.txt).
"""
import argparse
import io
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
REQUIRED_JOINTS = ["Hips", "Neck", "Head", "Ear.L.1", "Ear.L.2", "Ear.R.1", "Ear.R.2",
                   "Tail.1", "Tail.2", "Tail.3", "Tail.4", "UpperArm.L", "UpperArm.R"]
MORPHS = {  # name: (minimum moved vertices, minimum and maximum displacement in metres)
    "jawOpen": (150, 0.008, 0.06),
    "eyeBlinkLeft": (20, 0.006, 0.04),
    "eyeBlinkRight": (20, 0.006, 0.04),
}


class RigError(RuntimeError):
    pass


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2:
        raise RigError(f"{path} is not a glTF 2.0 binary")
    offset, gltf, binary = 12, None, b""
    while offset < len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8:offset + 8 + length]
        if kind == b"JSON":
            gltf = json.loads(chunk)
        elif kind == b"BIN\x00":
            binary = chunk
        offset += 8 + length
    if gltf is None:
        raise RigError("GLB has no JSON chunk")
    return gltf, binary


def view_bytes(gltf, binary, index):
    view = gltf["bufferViews"][index]
    start = view.get("byteOffset", 0)
    return binary[start:start + view["byteLength"]]


def read_accessor(gltf, binary, index):
    accessor = gltf["accessors"][index]
    dtype, width = COMPONENT[accessor["componentType"]], WIDTH[accessor["type"]]
    view = gltf["bufferViews"][accessor["bufferView"]]
    stride = view.get("byteStride", 0)
    item = np.dtype(dtype).itemsize * width
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    if stride and stride != item:
        raw = np.frombuffer(binary, np.uint8, count=stride * (count - 1) + item, offset=start)
        rows = np.lib.stride_tricks.as_strided(raw, (count, item), (stride, 1))
        values = np.frombuffer(rows.copy().tobytes(), dtype).reshape(count, width)
    else:
        values = np.frombuffer(binary, dtype, count=count * width, offset=start).reshape(count, width)
    if accessor.get("normalized"):
        values = values / float(np.iinfo(dtype).max)
    return values.astype(np.float64 if dtype == np.float32 else values.dtype)


def node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    rotation = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    matrix = np.eye(4)
    matrix[:3, :3] = rotation * np.array(node.get("scale", [1, 1, 1]))
    matrix[:3, 3] = node.get("translation", [0, 0, 0])
    return matrix


def mesh_world_matrix(gltf, mesh_node):
    parents = {child: i for i, node in enumerate(gltf["nodes"]) for child in node.get("children", [])}
    matrix, index = np.eye(4), mesh_node
    while index is not None:
        matrix = node_matrix(gltf["nodes"][index]) @ matrix
        index = parents.get(index)
    return matrix


def source_skin_audit(gltf, binary, primitive):
    """Describe the source skin so the report explains why it was replaced."""
    skins = gltf.get("skins", [])
    if not skins or "JOINTS_0" not in primitive["attributes"]:
        return {"joints": 0}
    joints = read_accessor(gltf, binary, primitive["attributes"]["JOINTS_0"]).astype(int)
    weights = read_accessor(gltf, binary, primitive["attributes"]["WEIGHTS_0"])
    dominant = joints[np.arange(len(joints)), weights.argmax(1)]
    names = [gltf["nodes"][j].get("name", str(j)) for j in skins[0]["joints"]]
    counts = np.bincount(dominant, minlength=len(names))
    at_origin = all(not any(abs(v) > 1e-6 for v in gltf["nodes"][j].get("translation", [0, 0, 0]))
                    and "matrix" not in gltf["nodes"][j] for j in skins[0]["joints"])
    finite_ibm = None
    if "inverseBindMatrices" in skins[0]:
        with np.errstate(all="ignore"):
            ibm = read_accessor(gltf, binary, skins[0]["inverseBindMatrices"])
            finite_ibm = bool(np.isfinite(ibm).all() and np.abs(ibm).max() < 1e3)
    return {
        "joints": len(names),
        "dominant_joint": names[int(counts.argmax())],
        "dominant_fraction": round(float(counts.max() / len(dominant)), 4),
        "all_joints_at_origin": at_origin,
        "inverse_bind_matrices_plausible": finite_ibm,
    }


def segment_distance(points, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((points - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(points - (a + t[:, None] * ab), axis=1), t


def rotate(points, origin, axis, angles):
    """Rodrigues rotation of each point about origin+axis by its own angle (radians)."""
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    v = points - origin
    cos, sin = np.cos(angles)[:, None], np.sin(angles)[:, None]
    return origin + v * cos + np.cross(axis, v) * sin + axis * (v @ axis)[:, None] * (1 - cos)


def ordered_bones(config):
    bones, order = config["bones"], []
    def visit(name):
        if name in order:
            return
        parent = bones[name].get("parent")
        if parent:
            if parent not in bones:
                raise RigError(f"Bone {name} has unknown parent {parent}")
            visit(parent)
        order.append(name)
    for name in bones:
        visit(name)
    if sum(1 for name in order if not bones[name].get("parent")) != 1:
        raise RigError("The rig must have exactly one root bone")
    return order


def bone_segments(config, order):
    bones, segments = config["bones"], {}
    for name in order:
        bone = bones[name]
        if "segment" in bone:
            segments[name] = [np.array(p, float) for p in bone["segment"]]
            continue
        children = [child for child in order if bones[child].get("parent") == name]
        end = bone.get("tail") or (bones[children[0]]["head"] if children else None)
        if end is None:
            raise RigError(f"Bone {name} needs a tail")
        segments[name] = [np.array(bone["head"], float), np.array(end, float)]
    return segments


def inverse_distance(points, segments, names, power=4.0):
    distance = np.stack([segment_distance(points, *segments[name])[0] for name in names], axis=1)
    raw = 1.0 / np.maximum(distance, 0.01) ** power
    return raw / raw.sum(1, keepdims=True)


def compute_weights(points, config, order):
    """Return an (N, joints) weight matrix in the order of `order`."""
    index = {name: i for i, name in enumerate(order)}
    segments = bone_segments(config, order)
    n, weights = len(points), np.zeros((len(points), len(order)))

    body = [name for name in order if name != "Head" and not name.startswith(("Ear.", "Tail."))]
    body_weights = np.zeros_like(weights)
    body_weights[:, [index[b] for b in body]] = inverse_distance(points, segments, body)

    volume = config["head_volume"]
    radius = np.linalg.norm((points - volume["center"]) / np.array(volume["radii"]), axis=1)
    head_share = (1 - smoothstep(0.95, 1.2, radius)) * smoothstep(*volume["min_y"], points[:, 1])
    head_weights = np.zeros_like(weights)
    head_weights[:, index["Head"]] = 1
    for ear, spec in config["ears"].items():
        base, tip = np.array(spec["base"]), np.array(spec["tip"])
        axis = tip - base
        s = ((points - base) @ axis) / (axis @ axis)
        radial = np.linalg.norm(points - (base + np.clip(s, 0, 1)[:, None] * axis), axis=1)
        allowed = spec["radius"][0] + (spec["radius"][1] - spec["radius"][0]) * np.clip(s, 0, 1)
        share = smoothstep(-0.12, 0.12, s) * (1 - smoothstep(allowed, allowed * 1.4, radial))
        share *= (points[:, 1] > spec["min_y"]) & (s < 1.25)
        upper = smoothstep(0.35, 0.65, s)
        head_weights[:, index["Head"]] -= share
        head_weights[:, index[ear + ".1"]] += share * (1 - upper)
        head_weights[:, index[ear + ".2"]] += share * upper
        head_share = np.maximum(head_share, share)
    head_weights[:, index["Head"]] = np.clip(head_weights[:, index["Head"]], 0, 1)
    mixed = (1 - head_share[:, None]) * body_weights + head_share[:, None] * head_weights

    tail = [name for name in order if name.startswith("Tail.")]
    polyline = np.min(np.stack([segment_distance(points, *segments[name])[0] for name in tail]), axis=0)
    start, direction = segments[tail[0]]
    along = (points - start) @ ((direction - start) / np.linalg.norm(direction - start))
    tail_share = smoothstep(-0.01, 0.04, along) * (1 - smoothstep(0.8, 1.0, polyline / config["tail"]["max_distance"]))
    tail_share *= points[:, 2] < config["tail"]["max_z"]
    tail_weights = np.zeros_like(weights)
    tail_weights[:, [index[t] for t in tail]] = inverse_distance(points, segments, tail)
    mixed = (1 - tail_share[:, None]) * mixed + tail_share[:, None] * tail_weights

    # glTF allows four influences per vertex in JOINTS_0/WEIGHTS_0.
    top = np.argsort(-mixed, axis=1)[:, :4]
    top_weights = np.take_along_axis(mixed, top, axis=1)
    top_weights /= top_weights.sum(1, keepdims=True)
    return top.astype(np.uint8), top_weights.astype(np.float32), head_share


def jaw_open(points, head_share, config):
    jaw = config["jaw"]
    line = jaw["mouth_line"]
    below = points[:, 1] - (line["y"] + line["slope_x"] * (points[:, 0] - line["x"])
                           + line["slope_z"] * (points[:, 2] - line["z"]))
    hinge = np.array(jaw["hinge"], float)
    mask = (smoothstep(-0.0005, -0.0025, below)
            * smoothstep(*jaw["min_z"], points[:, 2])
            * (1 - smoothstep(*jaw["half_width"], np.abs(points[:, 0] - hinge[0])))
            * smoothstep(*jaw["min_y"], points[:, 1])
            * (head_share > 0.5))
    roll = math.radians(jaw["roll_degrees"])
    moved = rotate(points, hinge, [math.cos(roll), math.sin(roll), 0], math.radians(jaw["open_degrees"]) * mask)
    return moved - points


def eye_blink(points, spec, eyes):
    cx, cy = spec["center"]
    rx, ry = spec["radii"]
    near = (np.abs(points[:, 0] - cx) < 0.01) & (np.abs(points[:, 1] - cy) < 0.01)
    if not near.any():
        raise RigError(f"No surface found at eye centre {spec['center']}")
    surface = points[near, 2].max()
    roll = math.radians(eyes["roll_degrees"])
    cos, sin = math.cos(roll), math.sin(roll)
    dx, dy = points[:, 0] - cx, points[:, 1] - cy
    u, w = cos * dx + sin * dy, -sin * dx + cos * dy
    ellipse = np.hypot(u / (rx * 1.35), w / (ry * 1.35))
    falloff = (1 - smoothstep(0.7, 1.0, ellipse)) * (points[:, 2] > surface - eyes["depth"])
    lid = -0.3 * ry
    # The upper lid slides down to a line just below the pupil centre; the lower lid rises.
    closed = np.where(w > lid, lid + (w - lid) * 0.05, lid + (w - lid) * 0.5)
    w_new = w + (closed - w) * falloff
    delta = np.zeros_like(points)
    delta[:, 0] = cos * u - sin * w_new - dx
    delta[:, 1] = sin * u + cos * w_new - dy
    delta[:, 2] = 0.003 * falloff * (w > lid)
    return delta


class GlbWriter:
    def __init__(self):
        self.binary, self.views, self.accessors = bytearray(), [], []

    def view(self, data, target=None):
        while len(self.binary) % 4:
            self.binary += b"\0"
        entry = {"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data)}
        if target:
            entry["target"] = target
        self.binary += data
        self.views.append(entry)
        return len(self.views) - 1

    def accessor(self, array, kind, component, target=None, bounds=False):
        array = np.ascontiguousarray(array)
        entry = {"bufferView": self.view(array.tobytes(), target), "componentType": component,
                 "count": int(array.shape[0]), "type": kind}
        if bounds:
            entry["min"] = array.min(0).tolist()
            entry["max"] = array.max(0).tolist()
        self.accessors.append(entry)
        return len(self.accessors) - 1

    def sparse_vec3(self, delta):
        """Morph deltas are mostly zero, so store only moved vertices."""
        moved = np.flatnonzero(np.abs(delta).max(1) > 1e-7).astype(np.uint32)
        values = delta[moved].astype(np.float32)
        self.accessors.append({
            "componentType": 5126, "count": int(len(delta)), "type": "VEC3",
            "min": np.minimum(values.min(0), 0).tolist(), "max": np.maximum(values.max(0), 0).tolist(),
            "sparse": {"count": int(len(moved)),
                       "indices": {"bufferView": self.view(moved.tobytes()), "componentType": 5125},
                       "values": {"bufferView": self.view(values.tobytes())}},
        })
        return len(self.accessors) - 1

    def glb(self, gltf):
        gltf["bufferViews"], gltf["accessors"] = self.views, self.accessors
        gltf["buffers"] = [{"byteLength": len(self.binary)}]
        text = json.dumps(gltf, separators=(",", ":")).encode()
        text += b" " * (-len(text) % 4)
        binary = bytes(self.binary) + b"\0" * (-len(self.binary) % 4)
        total = 12 + 8 + len(text) + 8 + len(binary)
        return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(text), b"JSON") + text
                + struct.pack("<I4s", len(binary), b"BIN\x00") + binary)


def encode_image(raw, mime, max_size):
    image = Image.open(io.BytesIO(raw))
    image.load()
    if max(image.size) > max_size:
        scale = max_size / max(image.size)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    out = io.BytesIO()
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        image.save(out, "PNG", optimize=True)
        return out.getvalue(), "image/png"
    image.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue(), "image/jpeg"


def audit(points, joints, weights, order, morphs, source):
    names = np.array(order)
    dominant = names[joints[np.arange(len(joints)), weights.argmax(1)]]
    counts = {name: int((dominant == name).sum()) for name in order}
    report = {
        "vertices": int(len(points)),
        "joints": order,
        "dominant_vertices_per_joint": counts,
        "hips_dominant_fraction": round(counts["Hips"] / len(points), 4),
        "morph_targets": {},
        "source_skin": source,
    }
    problems = []
    missing = [name for name in REQUIRED_JOINTS if name not in order]
    if missing:
        problems.append(f"missing joints {missing}")
    if not np.allclose(weights.sum(1), 1, atol=1e-4) or not np.isfinite(weights).all():
        problems.append("skin weights are not normalised")
    if report["hips_dominant_fraction"] > 0.5:
        problems.append("rig is still effectively bound to Hips")
    for name, minimum in [("Head", 1000), ("Ear.L.2", 30), ("Ear.R.2", 30), ("Tail.4", 300), ("UpperArm.L", 50), ("UpperArm.R", 50)]:
        if counts.get(name, 0) < minimum:
            problems.append(f"{name} drives only {counts.get(name, 0)} vertices (< {minimum})")
    for name, (min_count, min_move, max_move) in MORPHS.items():
        delta = morphs.get(name)
        if delta is None:
            problems.append(f"missing morph target {name}")
            continue
        length = np.linalg.norm(delta, axis=1)
        moved, peak = int((length > 1e-4).sum()), float(length.max())
        report["morph_targets"][name] = {"moved_vertices": moved, "max_displacement": round(peak, 4)}
        if moved < min_count or not (min_move <= peak <= max_move):
            problems.append(f"morph {name} moves {moved} vertices by up to {peak:.4f} m")
    report["problems"] = problems
    return report


def build(source, destination, config, max_texture):
    gltf, binary = read_glb(source)
    meshes = [i for i, node in enumerate(gltf["nodes"]) if "mesh" in node]
    if len(meshes) != 1 or len(gltf["meshes"][gltf["nodes"][meshes[0]]["mesh"]]["primitives"]) != 1:
        raise RigError("Expected exactly one mesh node with one primitive")
    primitive = gltf["meshes"][gltf["nodes"][meshes[0]]["mesh"]]["primitives"][0]
    if primitive.get("mode", 4) != 4:
        raise RigError("Only triangle meshes are supported")
    attributes = primitive["attributes"]
    world = mesh_world_matrix(gltf, meshes[0])
    points = read_accessor(gltf, binary, attributes["POSITION"]) @ world[:3, :3].T + world[:3, 3]
    normals = read_accessor(gltf, binary, attributes["NORMAL"]) @ np.linalg.inv(world[:3, :3])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    uvs = read_accessor(gltf, binary, attributes["TEXCOORD_0"]) if "TEXCOORD_0" in attributes else None
    indices = read_accessor(gltf, binary, primitive["indices"]).ravel().astype(np.uint32)

    order = ordered_bones(config)
    joints, weights, head_share = compute_weights(points, config, order)
    morphs = {"jawOpen": jaw_open(points, head_share, config)}
    for name in ("eyeBlinkLeft", "eyeBlinkRight"):
        morphs[name] = eye_blink(points, config["eyes"][name], config["eyes"])
    report = audit(points, joints, weights, order, morphs, source_skin_audit(gltf, binary, primitive))
    if report["problems"]:
        print("RUFUS_RIG_AUDIT=" + json.dumps(report, sort_keys=True))
        raise RigError("Rig audit failed: " + "; ".join(report["problems"]))

    writer = GlbWriter()
    attributes_out = {
        "POSITION": writer.accessor(points.astype(np.float32), "VEC3", 5126, 34962, bounds=True),
        "NORMAL": writer.accessor(normals.astype(np.float32), "VEC3", 5126, 34962),
        "JOINTS_0": writer.accessor(joints, "VEC4", 5121, 34962),
        "WEIGHTS_0": writer.accessor(weights, "VEC4", 5126, 34962),
    }
    if uvs is not None:
        attributes_out["TEXCOORD_0"] = writer.accessor(uvs.astype(np.float32), "VEC2", 5126, 34962)
    small = indices.max() < 65536
    index_accessor = writer.accessor(indices.astype(np.uint16 if small else np.uint32), "SCALAR", 5123 if small else 5125, 34963)
    targets = [{"POSITION": writer.sparse_vec3(morphs[name])} for name in MORPHS]

    heads = {name: np.array(config["bones"][name]["head"], float) for name in order}
    nodes = [{"name": "Rufus", "children": [1, 2]},
             {"name": "RufusMesh", "mesh": 0, "skin": 0}]
    node_of = {name: 2 + i for i, name in enumerate(order)}
    for name in order:
        parent = config["bones"][name].get("parent")
        offset = heads[name] - (heads[parent] if parent else 0)
        node = {"name": name, "translation": [round(float(v), 6) for v in offset]}
        children = [node_of[child] for child in order if config["bones"][child].get("parent") == name]
        if children:
            node["children"] = children
        nodes.append(node)
    inverse_bind = np.stack([np.eye(4) for _ in order])
    for i, name in enumerate(order):
        inverse_bind[i, :3, 3] = -heads[name]
    ibm = writer.accessor(inverse_bind.transpose(0, 2, 1).reshape(len(order), 16).astype(np.float32), "MAT4", 5126)

    images = []
    for image in gltf.get("images", []):
        if "bufferView" not in image:
            raise RigError("External image URIs are not supported")
        data, mime = encode_image(view_bytes(gltf, binary, image["bufferView"]), image.get("mimeType"), max_texture)
        images.append({"name": image.get("name", "texture"), "mimeType": mime, "bufferView": writer.view(data)})
    materials = [{k: v for k, v in m.items() if k != "extensions"} for m in gltf.get("materials", [])]

    out = {
        "asset": {"version": "2.0", "generator": "debatt-ai-animal-zoo rig_rufus.py",
                  "extras": {"source_generator": gltf.get("asset", {}).get("generator")}},
        "scene": 0, "scenes": [{"name": "Rufus", "nodes": [0]}], "nodes": nodes,
        "meshes": [{"name": "Rufus", "weights": [0.0] * len(targets),
                    "extras": {"targetNames": list(MORPHS)},
                    "primitives": [{"attributes": attributes_out, "indices": index_accessor,
                                    "material": primitive.get("material", 0), "targets": targets}]}],
        "skins": [{"name": "RufusRig", "skeleton": node_of[order[0]], "inverseBindMatrices": ibm,
                   "joints": [node_of[name] for name in order]}],
        "materials": materials, "textures": gltf.get("textures", []),
        "samplers": gltf.get("samplers", []), "images": images,
    }
    out = {k: v for k, v in out.items() if v != []}
    payload = writer.glb(out)
    report["output_bytes"] = len(payload)
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_bytes(payload)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parent.parent / "assets/rufus/rig.json")
    parser.add_argument("--max-texture", type=int, default=1024)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if args.source.resolve() == args.destination.resolve():
        raise SystemExit("Refusing to overwrite the source model")
    try:
        report = build(args.source, args.destination, json.loads(args.config.read_text()), args.max_texture)
    except RigError as error:
        raise SystemExit(f"error: {error}")
    print("RUFUS_RIG_AUDIT=" + json.dumps(report, sort_keys=True))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {args.destination} ({report['output_bytes'] / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
