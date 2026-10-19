import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = "public/vision";
await mkdir(directory, { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", directory, {
  recursive: true,
});
await cp(
  "node_modules/@mediapipe/tasks-vision/vision_bundle.cjs",
  `${directory}/vision_bundle.js`,
);
const url =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const expected =
  "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
let bytes: Buffer;
try {
  bytes = await readFile(`${directory}/face_landmarker.task`);
} catch {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== expected)
  throw new Error("Model checksum mismatch; no model written.");
await writeFile(`${directory}/face_landmarker.task`, bytes);
console.log(
  "Local vision assets ready: MediaPipe 0.10.32, float16 model v1, SHA-256 verified.",
);
const phonePath = `${directory}/efficientdet_lite0.tflite`;
let phone: Buffer;
try {
  phone = await readFile(phonePath);
} catch {
  const r = await fetch(
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  );
  if (!r.ok) throw new Error(`Phone model download failed: ${r.status}`);
  phone = Buffer.from(await r.arrayBuffer());
}
if (
  createHash("sha256").update(phone).digest("hex") !==
  "4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993"
)
  throw new Error("Phone model checksum mismatch");
await writeFile(phonePath, phone);
console.log("EfficientDet-Lite0 float16 v1 ready; checksum verified.");
