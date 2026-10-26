"""CI test for rig_rufus.py on a synthetic fox, so no licensed model is needed.

Run: python3 -m unittest discover -s scripts -p "test_rig_*.py"
"""
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rig_rufus  # noqa: E402

CONFIG = json.loads((Path(__file__).resolve().parent.parent / "assets/rufus/rig.json").read_text())


def ellipsoid(rng, center, radii, count):
    direction = rng.normal(size=(count, 3))
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    return np.asarray(center) + direction * np.asarray(radii)


def capsule(rng, a, b, radius, count):
    t = rng.random(count)[:, None]
    return np.asarray(a) + t * (np.asarray(b) - np.asarray(a)) + ellipsoid(rng, (0, 0, 0), (radius,) * 3, count)


def synthetic_fox():
    """A blob fox placed on the landmarks of the real model."""
    rng, bones = np.random.default_rng(7), CONFIG["bones"]
    parts = [
        ellipsoid(rng, (-0.05, 0.80, 0.20), (0.13, 0.12, 0.18), 9000),        # head and snout
        capsule(rng, (0.02, 0.05, 0.12), (0.02, 0.62, 0.14), 0.09, 6000),    # body and legs
        capsule(rng, bones["Ear.L.1"]["head"], bones["Ear.L.2"]["tail"], 0.02, 600),
        capsule(rng, bones["Ear.R.1"]["head"], bones["Ear.R.2"]["tail"], 0.02, 600),
        capsule(rng, bones["Tail.1"]["head"], bones["Tail.4"]["tail"], 0.07, 4000),
        capsule(rng, bones["UpperArm.L"]["head"], bones["Hand.L"]["tail"], 0.03, 1500),
        capsule(rng, bones["UpperArm.R"]["head"], bones["Hand.R"]["tail"], 0.03, 1500),
    ]
    return np.concatenate(parts).astype(np.float32)


def write_source(path, points, with_skin=True):
    """Write a minimal Tripo-like GLB: one textured, optionally degenerate-skinned mesh."""
    writer = rig_rufus.GlbWriter()
    count = len(points) - len(points) % 3
    points = points[:count]
    normals = points - points.mean(0)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    attributes = {
        "POSITION": writer.accessor(points, "VEC3", 5126, 34962, bounds=True),
        "NORMAL": writer.accessor(normals.astype(np.float32), "VEC3", 5126, 34962),
        "TEXCOORD_0": writer.accessor(np.zeros((count, 2), np.float32), "VEC2", 5126, 34962),
    }
    nodes = [{"name": "Armature", "children": [1, 2]}, {"name": "mesh", "mesh": 0}, {"name": "mixamorig:Hips", "children": [3]},
             {"name": "mixamorig:Head"}]
    gltf = {"asset": {"version": "2.0", "generator": "Tripo"}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes}
    if with_skin:
        attributes["JOINTS_0"] = writer.accessor(np.zeros((count, 4), np.uint16), "VEC4", 5123, 34962)
        weights = np.zeros((count, 4), np.float32)
        weights[:, 0] = 1
        attributes["WEIGHTS_0"] = writer.accessor(weights, "VEC4", 5126, 34962)
        nodes[1]["skin"] = 0
        garbage = np.frombuffer(b"glTF" * 32, np.float32).copy()  # bytes from another file, as in the Tripo export
        gltf["skins"] = [{"joints": [2, 3], "inverseBindMatrices": writer.accessor(garbage.reshape(2, 16), "MAT4", 5126)}]
    image = io.BytesIO()
    Image.new("RGB", (2048, 2048), (200, 90, 30)).save(image, "JPEG")
    gltf["images"] = [{"name": "basecolor.jpg", "mimeType": "image/jpeg", "bufferView": writer.view(image.getvalue())}]
    gltf["textures"] = [{"source": 0}]
    gltf["materials"] = [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "extensions": {"KHR_materials_volume": {}}}]
    gltf["extensionsUsed"] = ["KHR_materials_volume", "FB_ngon_encoding"]
    indices = writer.accessor(np.arange(count, dtype=np.uint32), "SCALAR", 5125, 34963)
    gltf["meshes"] = [{"primitives": [{"attributes": attributes, "indices": indices, "material": 0}]}]
    Path(path).write_bytes(writer.glb(gltf))


class RigRufusTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.source, cls.output = root / "source.glb", root / "rigged.glb"
        write_source(cls.source, synthetic_fox())
        cls.source_bytes = cls.source.read_bytes()
        cls.report = rig_rufus.build(cls.source, cls.output, CONFIG, 1024)
        cls.gltf, cls.binary = rig_rufus.read_glb(cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def accessor(self, index):
        return rig_rufus.read_accessor(self.gltf, self.binary, index)

    def test_source_is_untouched_and_degenerate_skin_is_reported(self):
        self.assertEqual(self.source.read_bytes(), self.source_bytes)
        source = self.report["source_skin"]
        self.assertTrue(source["all_joints_at_origin"])
        self.assertFalse(source["inverse_bind_matrices_plausible"])
        self.assertEqual(source["dominant_fraction"], 1.0)

    def test_skeleton_has_talking_joints_and_consistent_bind_pose(self):
        names = [self.gltf["nodes"][j]["name"] for j in self.gltf["skins"][0]["joints"]]
        for required in rig_rufus.REQUIRED_JOINTS:
            self.assertIn(required, names)
        parents = {c: i for i, n in enumerate(self.gltf["nodes"]) for c in n.get("children", [])}
        inverse_bind = self.accessor(self.gltf["skins"][0]["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        for joint, ibm in zip(self.gltf["skins"][0]["joints"], inverse_bind):
            world, node = np.zeros(3), joint
            while node is not None:
                world += self.gltf["nodes"][node].get("translation", [0, 0, 0])
                node = parents.get(node)
            name = self.gltf["nodes"][joint]["name"]
            np.testing.assert_allclose(world, CONFIG["bones"][name]["head"], atol=1e-5)
            np.testing.assert_allclose(ibm[:3, 3], -world, atol=1e-5)

    def test_weights_are_normalised_and_not_bound_to_hips(self):
        attributes = self.gltf["meshes"][0]["primitives"][0]["attributes"]
        weights = self.accessor(attributes["WEIGHTS_0"])
        joints = self.accessor(attributes["JOINTS_0"])
        np.testing.assert_allclose(weights.sum(1), 1, atol=1e-5)
        self.assertLess(joints.max(), len(self.gltf["skins"][0]["joints"]))
        self.assertLess(self.report["hips_dominant_fraction"], 0.5)
        self.assertGreater(self.report["dominant_vertices_per_joint"]["Tail.4"], 300)

    def test_face_morph_targets_exist_and_only_move_the_face(self):
        mesh = self.gltf["meshes"][0]
        self.assertEqual(mesh["extras"]["targetNames"], ["jawOpen", "eyeBlinkLeft", "eyeBlinkRight"])
        positions = self.accessor(mesh["primitives"][0]["attributes"]["POSITION"])
        for name, target in zip(mesh["extras"]["targetNames"], mesh["primitives"][0]["targets"]):
            accessor = self.gltf["accessors"][target["POSITION"]]
            self.assertIn("sparse", accessor)
            sparse = accessor["sparse"]
            view = self.gltf["bufferViews"][sparse["indices"]["bufferView"]]
            indices = np.frombuffer(self.binary, np.uint32, sparse["count"], view["byteOffset"])
            self.assertGreater(len(indices), 20, name)
            self.assertTrue((positions[indices, 1] > 0.6).all(), f"{name} moves vertices outside the head")
        jaw = self.report["morph_targets"]["jawOpen"]
        self.assertGreaterEqual(jaw["moved_vertices"], 150)

    def test_output_is_mobile_friendly_glb(self):
        self.assertNotIn("extensionsUsed", self.gltf)
        self.assertNotIn("extensions", self.gltf["materials"][0])
        view = self.gltf["bufferViews"][self.gltf["images"][0]["bufferView"]]
        image = Image.open(io.BytesIO(self.binary[view["byteOffset"]:view["byteOffset"] + view["byteLength"]]))
        self.assertEqual(image.size, (1024, 1024))
        total = struct.unpack_from("<I", self.output.read_bytes(), 8)[0]
        self.assertEqual(total, self.output.stat().st_size)

    def test_audit_rejects_a_rig_that_cannot_talk(self):
        config = json.loads(json.dumps(CONFIG))
        config["jaw"]["open_degrees"] = 0
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(rig_rufus.RigError, "morph jawOpen"):
            rig_rufus.build(self.source, Path(tmp) / "bad.glb", config, 1024)
        config = json.loads(json.dumps(CONFIG))
        del config["bones"]["Tail.4"]
        config["bones"]["Tail.3"]["tail"] = [-0.35, 0.40, -0.33]
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(rig_rufus.RigError, "missing joints"):
            rig_rufus.build(self.source, Path(tmp) / "bad.glb", config, 1024)


if __name__ == "__main__":
    unittest.main()
