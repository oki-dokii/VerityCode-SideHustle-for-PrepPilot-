import { purgeEvidence } from "./vision.js";
import "dotenv/config";
import express from "express";
import path from "node:path";
import { makeApp } from "./app.js";
import { migrate, pool } from "./db.js";
import { expireAttempts, workOne } from "./service.js";
await migrate();
const app = makeApp();
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
}
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`VerityCode API: http://127.0.0.1:${port}`),
);
let working = false;
const tick = setInterval(async () => {
  if (working) return;
  working = true;
  try {
    await workOne();
  } catch (error) {
    console.error("Worker unavailable:", (error as Error).name);
  } finally {
    working = false;
  }
}, 500);
await purgeEvidence();
const retention = setInterval(() => {
  void purgeEvidence().catch(() =>
    console.error("Evidence expiry failed; retrying."),
  );
}, 60000);
const expiry = setInterval(() => {
  void expireAttempts().catch(() =>
    console.error("Deadline sweep failed; retrying."),
  );
}, 1000);
async function stop() {
  clearInterval(tick);
  clearInterval(expiry);
  clearInterval(retention);
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
