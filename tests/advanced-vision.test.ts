import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GazeTracker,
  PhoneTracker,
  fitGaze,
} from "../shared/advancedVision.js";
const pose = { yaw: 0, pitch: 0, roll: 0 };
const features = (x: number, y: number) => ({
  x: 0.2 + 0.3 * x,
  y: 0.03 + 0.2 * y,
  pose,
});
function calibrate(g: GazeTracker, wrongValidation = false) {
  let now = 0;
  g.start(now);
  let guard = 0;
  while (g.target && guard++ < 300) {
    now += 200;
    const target = g.target;
    g.update(
      features(
        wrongValidation && g.step >= 9 ? 1 - target.x : target.x,
        target.y,
      ),
      now,
    );
  }
  return now;
}
test("gaze fits calibrated targets and requires held-out validation", () => {
  const g = new GazeTracker();
  const now = calibrate(g);
  assert.equal(g.state, "inside");
  assert.ok(g.error! < 0.01);
  assert.equal(g.update(undefined, now + 200), "unavailable");
  const failed = new GazeTracker();
  calibrate(failed, true);
  assert.equal(failed.state, "uncalibrated");
  assert.match(failed.message, /Validation failed/);
  assert.equal(
    fitGaze(
      Array.from({ length: 9 }, () => ({
        features: features(0.5, 0.5),
        target: { x: 0.5, y: 0.5 },
      })),
    ),
    undefined,
  );
});
test("gaze only reports repeated sustained episodes; stale input, head motion and resize disable estimates", () => {
  const g = new GazeTracker();
  let now = calibrate(g);
  for (let episode = 0; episode < 3; episode++) {
    g.update(features(0.5, 0.5), (now += 200));
    for (let i = 0; i < 16; i++) g.update(features(-1, 0.5), (now += 200));
    assert.equal(g.state, episode === 2 ? "repeated" : "outside");
  }
  assert.equal(
    g.update(
      { ...features(-1, 0.5), pose: { ...pose, yaw: 25 } },
      (now += 200),
    ),
    "unavailable",
  );
  assert.equal(g.update(features(-1, 0.5), (now += 3000)), "unavailable");
  g.invalidate("Window changed");
  assert.equal(g.update(features(-1, 0.5), (now += 200)), "uncalibrated");
});
test("calibration failure and interruption never imply off-screen gaze", () => {
  const g = new GazeTracker();
  g.start(0);
  g.update(undefined, 16000);
  assert.equal(g.state, "uncalibrated");
  assert.match(g.message, /failed/);
  const h = new GazeTracker();
  h.start(0);
  for (let t = 200; t < 20000; t += 200) h.update(features(0.5, 0.5), t);
  assert.notEqual(h.state, "outside");
  assert.notEqual(h.state, "repeated");
});
test("phone threshold requires sustained fresh model detections and resets on gaps", () => {
  const p = new PhoneTracker();
  assert.equal(p.update(0.9, 0), "unknown");
  assert.equal(p.update(0.8, 1000), "detected");
  assert.equal(p.update(0.2, 2000), "not_detected");
  assert.equal(p.update(0.95, 3000), "unknown");
  assert.equal(p.update(0.95, 6000), "unknown");
  assert.equal(p.update(undefined, 6200), "unknown");
});
test("gaze interruptions cannot manufacture repeated departures", () => {
  const g = new GazeTracker();
  let now = calibrate(g);
  for (let episode = 0; episode < 3; episode++) {
    g.update(undefined, (now += 2000));
    for (let i = 0; i < 16; i++) g.update(features(-1, 0.5), (now += 200));
    assert.equal(g.state, "outside");
  }
});
