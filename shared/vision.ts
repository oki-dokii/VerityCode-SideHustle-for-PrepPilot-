export const VISION_VERSION =
  "face-f16-v1/phone-efficientdet-f16-v1/gaze-ridge-v1/tasks-0.10.32/rules-2";
export const visionStates = [
  "one_face",
  "no_face",
  "multiple_faces",
  "head_turned",
  "unknown",
] as const;
export type VisionState = (typeof visionStates)[number];
export const visionLabels: Record<VisionState, string> = {
  one_face: "One face detected",
  no_face: "No face detected for 3 seconds",
  multiple_faces: "Multiple faces detected for 1 second",
  head_turned: "Head orientation changed for 3 seconds",
  unknown: "Camera observation unavailable",
};
export type Pose = { yaw: number; pitch: number; roll: number };
export type Sample = {
  faces: number;
  usable: boolean;
  pose?: Pose;
  inferenceMs: number;
};
// MediaPipe packs Eigen's column-major 4x4 similarity transform. Remove uniform scale.
// R = Rz(roll) Ry(yaw) Rx(pitch); degrees in model coordinates, not gaze direction.
export function matrixPose(m: number[]): Pose | undefined {
  if (m.length !== 16 || !m.every(Number.isFinite)) return;
  const scale = Math.hypot(m[0], m[1], m[2]);
  if (scale < 0.0001) return;
  const yaw = Math.asin(Math.max(-1, Math.min(1, -m[2] / scale)));
  if (Math.abs(Math.cos(yaw)) < 0.05) return;
  const deg = 180 / Math.PI;
  return {
    yaw: yaw * deg,
    pitch: Math.atan2(m[6], m[10]) * deg,
    roll: Math.atan2(m[1], m[0]) * deg,
  };
}
const difference = (a: number, b: number) => ((a - b + 540) % 360) - 180;
export class VisionRules {
  baseline?: Pose;
  private samples: Pose[] = [];
  calibrating = false;
  private candidate: VisionState = "unknown";
  private since = 0;
  private last = -Infinity;
  state: VisionState = "unknown";
  calibrate() {
    this.baseline = undefined;
    this.samples = [];
    this.calibrating = true;
  }
  update(sample: Sample, now: number): VisionState {
    if (now - this.last > 1500) {
      this.candidate = "unknown";
      this.state = "unknown";
      this.samples = [];
    }
    this.last = now;
    if (!sample.usable) {
      this.samples = [];
      this.candidate = this.state = "unknown";
      return this.state;
    }
    if (this.calibrating) {
      if (sample.faces !== 1 || !sample.pose) this.samples = [];
      else {
        this.samples.push(sample.pose);
        if (this.samples.length >= 15) {
          const axes = ["yaw", "pitch", "roll"] as const;
          const baseline = {} as Pose;
          for (const axis of axes)
            baseline[axis] = [...this.samples]
              .map((p) => p[axis])
              .sort((a, b) => a - b)[7];
          if (
            this.samples.every((p) =>
              axes.every(
                (axis) => Math.abs(difference(p[axis], baseline[axis])) <= 5,
              ),
            )
          ) {
            this.baseline = baseline;
            this.calibrating = false;
          }
          this.samples.shift();
        }
      }
    }
    let next: VisionState =
      sample.faces === 0
        ? "no_face"
        : sample.faces >= 2
          ? "multiple_faces"
          : "one_face";
    if (next === "one_face" && this.baseline && sample.pose) {
      const hysteresis = this.state === "head_turned" ? 5 : 0;
      if (
        Math.abs(difference(sample.pose.yaw, this.baseline.yaw)) >
          25 - hysteresis ||
        Math.abs(difference(sample.pose.pitch, this.baseline.pitch)) >
          20 - hysteresis
      )
        next = "head_turned";
    }
    if (next !== this.candidate) {
      this.candidate = next;
      this.since = now;
    }
    const threshold =
      next === "no_face" || next === "head_turned"
        ? 3000
        : next === "multiple_faces"
          ? 1000
          : 0;
    // Pending transitions are unknown, never extend the previous finding across recovery.
    this.state = now - this.since >= threshold ? next : "unknown";
    return this.state;
  }
}
