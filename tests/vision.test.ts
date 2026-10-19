import { test } from "node:test";
import assert from "node:assert/strict";
import { matrixPose, VisionRules } from "../shared/vision.js";
const pose = { yaw: 0, pitch: 0, roll: 0 };
const sample = { faces: 1, usable: true, pose, inferenceMs: 20 };
test("column-major pose handles yaw, pitch, roll, scale and invalid matrices", () => {
  const angle = Math.PI / 6,
    c = Math.cos(angle),
    s = Math.sin(angle);
  assert.ok(
    Math.abs(
      matrixPose([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])!.yaw - 30,
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(
      matrixPose([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])!.pitch - 30,
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(
      matrixPose(
        [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map((n) => n * 2),
      )!.roll - 30,
    ) < 1e-6,
  );
  assert.equal(matrixPose([]), undefined);
  assert.equal(matrixPose(Array(16).fill(0)), undefined);
});
test("short glances, sustained head changes, calibration and interrupted intervals", () => {
  const r = new VisionRules();
  r.calibrate();
  for (let t = 0; t <= 3000; t += 200) r.update(sample, t);
  assert.deepEqual(r.baseline, pose);
  const turned = { ...sample, pose: { ...pose, yaw: 35 } };
  for (let t = 3200; t < 6200; t += 200)
    assert.notEqual(r.update(turned, t), "head_turned");
  assert.equal(r.update(turned, 6200), "head_turned");
  assert.equal(
    r.update({ ...turned, pose: { ...pose, yaw: 22 } }, 6400),
    "head_turned",
  );
  assert.equal(r.update(sample, 6600), "one_face");
  r.update(turned, 6800);
  assert.equal(r.update(turned, 10000), "unknown");
  assert.equal(r.update({ ...sample, usable: false }, 10200), "unknown");
});
test("absence and multiple-face thresholds exclude dark frames and stalls", () => {
  const r = new VisionRules();
  for (let t = 0; t < 3000; t += 200)
    assert.equal(r.update({ ...sample, faces: 0 }, t), "unknown");
  assert.equal(r.update({ ...sample, faces: 0 }, 3000), "no_face");
  assert.equal(
    r.update({ ...sample, faces: 0, usable: false }, 3200),
    "unknown",
  );
  for (let t = 3400; t < 4400; t += 200)
    assert.equal(r.update({ ...sample, faces: 2 }, t), "unknown");
  assert.equal(r.update({ ...sample, faces: 2 }, 4400), "multiple_faces");
  assert.equal(r.update({ ...sample, faces: 2 }, 7000), "unknown");
});
test("unstable or interrupted calibration cannot establish a neutral baseline", () => {
  const r = new VisionRules();
  r.calibrate();
  for (let t = 0; t < 10000; t += 200)
    r.update({ ...sample, pose: { ...pose, yaw: t % 400 ? 20 : -20 } }, t);
  assert.equal(r.baseline, undefined);
  r.update({ ...sample, usable: false }, 10200);
  for (let t = 10400; t < 13000; t += 200) r.update(sample, t);
  assert.equal(r.baseline, undefined);
});
