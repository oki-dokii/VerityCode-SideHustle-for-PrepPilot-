import type { Pose } from "./vision";
export const gazeStates = [
  "uncalibrated",
  "calibrating",
  "unavailable",
  "inside",
  "outside",
  "repeated",
] as const;
export type GazeState = (typeof gazeStates)[number];
export const phoneStates = ["unknown", "not_detected", "detected"] as const;
export type PhoneState = (typeof phoneStates)[number];
export const gazeLabels: Record<GazeState, string> = {
  uncalibrated: "Gaze not calibrated",
  calibrating: "Gaze calibration in progress",
  unavailable: "Gaze estimate unavailable",
  inside: "Gaze estimate within calibrated region",
  outside: "Sustained gaze estimate outside calibrated region",
  repeated: "Repeated gaze estimates outside calibrated region",
};
export const phoneLabels: Record<PhoneState, string> = {
  unknown: "Phone check unavailable or awaiting confirmation",
  not_detected: "No phone detected in visible frame",
  detected: "Possible visible phone for 1 second",
};
export type Point = { x: number; y: number };
export type EyeFeatures = { x: number; y: number; pose: Pose };
const targets: Point[] = [
  ...[0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y }))),
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.7 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.7 },
];
const vector = (f: EyeFeatures) => [
  1,
  f.x,
  f.y,
  f.pose.yaw / 45,
  f.pose.pitch / 45,
];
function solve(matrix: number[][], values: number[]): number[] | undefined {
  const a = matrix.map((row, i) => [...row, values[i]]),
    n = values.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    if (Math.abs(a[k][k]) < 1e-10) return;
    const d = a[k][k];
    for (let j = k; j <= n; j++) a[k][j] /= d;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const f = a[i][k];
        for (let j = k; j <= n; j++) a[i][j] -= f * a[k][j];
      }
  }
  return a.map((row) => row[n]);
}
export function fitGaze(samples: { features: EyeFeatures; target: Point }[]) {
  if (
    samples.length < 9 ||
    samples.some(
      (s) =>
        !vector(s.features).every(Number.isFinite) ||
        !Number.isFinite(s.target.x) ||
        !Number.isFinite(s.target.y),
    )
  )
    return;
  if (
    ["x", "y"].some(
      (axis) =>
        Math.max(...samples.map((s) => s.features[axis as "x" | "y"])) -
          Math.min(...samples.map((s) => s.features[axis as "x" | "y"])) <
        0.015,
    )
  )
    return;
  const rows = samples.map((s) => vector(s.features));
  const matrix = Array.from({ length: 5 }, (_, i) =>
    Array.from(
      { length: 5 },
      (_, j) =>
        rows.reduce((sum, row) => sum + row[i] * row[j], 0) +
        (i === j && i !== 0 ? 1e-5 : 0),
    ),
  );
  const x = solve(
    matrix,
    Array.from({ length: 5 }, (_, i) =>
      rows.reduce((sum, row, k) => sum + row[i] * samples[k].target.x, 0),
    ),
  );
  const y = solve(
    matrix,
    Array.from({ length: 5 }, (_, i) =>
      rows.reduce((sum, row, k) => sum + row[i] * samples[k].target.y, 0),
    ),
  );
  if (!x || !y) return;
  return (f: EyeFeatures): Point => ({
    x: vector(f).reduce((sum, v, i) => sum + v * x[i], 0),
    y: vector(f).reduce((sum, v, i) => sum + v * y[i], 0),
  });
}
export class GazeTracker {
  step = -1;
  state: GazeState = "uncalibrated";
  message = "Gaze needs its own calibration";
  error?: number;
  private collected: EyeFeatures[] = [];
  private training: { features: EyeFeatures; target: Point }[] = [];
  private errors: number[] = [];
  private predict?: ReturnType<typeof fitGaze>;
  private baseline?: Pose;
  private entered = 0;
  private last = -Infinity;
  private outsideSince?: number;
  private episodes: number[] = [];
  private episode = false;
  get target() {
    return this.step >= 0 ? targets[this.step] : undefined;
  }
  start(now: number) {
    this.invalidate();
    this.step = 0;
    this.entered = now;
    this.state = "calibrating";
    this.message = "Follow the dot with your eyes; keep your head still.";
  }
  invalidate(message = "Gaze needs its own calibration") {
    this.step = -1;
    this.predict = undefined;
    this.baseline = undefined;
    this.error = undefined;
    this.collected = [];
    this.training = [];
    this.errors = [];
    this.outsideSince = undefined;
    this.episodes = [];
    this.episode = false;
    this.state = "uncalibrated";
    this.message = message;
  }
  update(f: EyeFeatures | undefined, now: number): GazeState {
    if (f && !vector(f).every(Number.isFinite)) f = undefined;
    const gap = now - this.last > 1500;
    this.last = now;
    if (gap) {
      this.outsideSince = undefined;
      // An interruption does not establish a return to the screen or a new glance.
      this.collected = [];
    }
    if (this.step >= 0) {
      if (now - this.entered > 15000) {
        this.invalidate(
          "Calibration failed: insufficient stable eye samples. Try better lighting or continue without gaze.",
        );
        return this.state;
      }
      if (!f) {
        this.collected = [];
        return this.state;
      }
      if (now - this.entered < 600) return this.state;
      this.collected.push(f);
      if (this.collected.length < 10) return this.state;
      const mean = { x: 0, y: 0, pose: { yaw: 0, pitch: 0, roll: 0 } };
      for (const v of this.collected) {
        mean.x += v.x / 10;
        mean.y += v.y / 10;
        for (const axis of ["yaw", "pitch", "roll"] as const)
          mean.pose[axis] += v.pose[axis] / 10;
      }
      if (
        this.collected.some(
          (v) =>
            Math.abs(v.x - mean.x) > 0.06 ||
            Math.abs(v.y - mean.y) > 0.06 ||
            Math.abs(v.pose.yaw - mean.pose.yaw) > 5 ||
            Math.abs(v.pose.pitch - mean.pose.pitch) > 5,
        )
      ) {
        this.collected.shift();
        return this.state;
      }
      if (this.step === 0) this.baseline = mean.pose;
      if (
        !this.baseline ||
        Math.abs(mean.pose.yaw - this.baseline.yaw) > 12 ||
        Math.abs(mean.pose.pitch - this.baseline.pitch) > 12
      ) {
        this.invalidate(
          "Calibration failed: head moved too far. Keep your head still and retry.",
        );
        return this.state;
      }
      if (this.step < 9)
        this.training.push({ features: mean, target: targets[this.step] });
      else {
        const p = this.predict!(mean),
          t = targets[this.step];
        this.errors.push(Math.hypot(p.x - t.x, p.y - t.y));
      }
      this.step++;
      this.collected = [];
      this.entered = now;
      if (this.step === 9) {
        this.predict = fitGaze(this.training);
        if (!this.predict) {
          this.invalidate(
            "Calibration failed: eye movement could not be distinguished.",
          );
          return this.state;
        }
      }
      if (this.step === targets.length) {
        this.error = Math.max(...this.errors);
        this.step = -1;
        if (this.error > 0.18) {
          this.invalidate(
            "Validation failed on unseen targets. Gaze findings disabled; retry or continue without gaze.",
          );
          return this.state;
        }
        this.state = "inside";
        this.message = `Gaze calibration passed local checks (maximum held-out error ${Math.round(this.error * 100)}% of viewport). Experimental.`;
      }
      return this.state;
    }
    if (!this.predict) {
      this.state = "uncalibrated";
      return this.state;
    }
    if (
      !f ||
      !this.baseline ||
      Math.abs(f.pose.yaw - this.baseline.yaw) > 15 ||
      Math.abs(f.pose.pitch - this.baseline.pitch) > 15
    ) {
      this.outsideSince = undefined;
      this.state = "unavailable";
      return this.state;
    }
    const p = this.predict(f),
      margin = Math.max(0.12, (this.error || 0) * 1.5);
    const outside =
      p.x < -margin || p.x > 1 + margin || p.y < -margin || p.y > 1 + margin;
    if (!outside) {
      this.outsideSince = undefined;
      this.episode = false;
      this.state = "inside";
      return this.state;
    }
    this.outsideSince ??= now;
    if (now - this.outsideSince < 3000) {
      this.state = "unavailable";
      return this.state;
    }
    this.episodes = this.episodes.filter((t) => now - t <= 60000);
    if (!this.episode) {
      this.episodes.push(now);
      this.episode = true;
    }
    this.state = this.episodes.length >= 3 ? "repeated" : "outside";
    return this.state;
  }
}
export class PhoneTracker {
  private since?: number;
  private last = -Infinity;
  update(score: number | undefined, now: number): PhoneState {
    if (now - this.last > 2500) this.since = undefined;
    this.last = now;
    if (score === undefined) {
      this.since = undefined;
      return "unknown";
    }
    if (score < 0.6) {
      this.since = undefined;
      return "not_detected";
    }
    this.since ??= now;
    return now - this.since >= 1000 ? "detected" : "unknown";
  }
}
