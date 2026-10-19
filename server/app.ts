import {
  screenConsent,
  screenCapture,
  screenStop,
  startScreen,
  stopScreen,
  captureScreen,
  screenReport,
  readScreen,
  deleteScreen,
} from "./screen.js";
import {
  cameraConsent,
  cameraBatch,
  startCamera,
  stopCamera,
  ingestCamera,
  cameraReport,
  saveEvidence,
  readEvidence,
  deleteEvidence,
} from "./vision.js";
import {
  batchSchema,
  startMonitoring,
  ingestEvents,
  monitoringReport,
} from "./monitoring.js";
import { allowedOrigins } from "./origins.js";
import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { problem } from "./problem.js";
import { runnerConfigured } from "./runner.js";
import {
  changeLanguage,
  HttpError,
  createAttempt,
  getAttempt,
  runCode,
  saveDraft,
  submit,
  retryGrading,
} from "./service.js";
const uuid = z.string().uuid();
const code = z.string().max(50000);
const revision = z.number().int().min(0);
export function makeApp() {
  const app = express();
  const origins = allowedOrigins(
    process.env.APP_ORIGIN || "http://127.0.0.1:5173",
    process.env.NODE_ENV === "production",
  );
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (req.get("X-VerityCode") !== "1" ||
        (req.get("Origin") && !origins.has(req.get("Origin")!)))
    )
      return res.status(403).json({ error: "Request origin is not allowed." });
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({
      database: "ready",
      runner: runnerConfigured() ? "configured" : "not_configured",
      serverNow: new Date().toISOString(),
    });
  });
  app.use("/api", async (req, res, next) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("vc_session="))
      ?.slice(11);
    let token = raw && /^[a-f0-9]{64}$/.test(raw) ? raw : undefined;
    let owner = token ? createHash("sha256").update(token).digest("hex") : "";
    const existing = owner
      ? await pool.query("SELECT id FROM sessions WHERE id=$1", [owner])
      : { rowCount: 0 };
    if (!existing.rowCount) {
      if (req.path !== "/bootstrap")
        return res
          .status(401)
          .json({ error: "Session expired. Return to the dashboard." });
      token = randomBytes(32).toString("hex");
      owner = createHash("sha256").update(token).digest("hex");
      await pool.query("INSERT INTO sessions(id) VALUES($1)", [owner]);
      res.cookie("vc_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 90 * 86400000,
        path: "/",
      });
    }
    res.locals.owner = owner;
    next();
  });
  app.get("/api/bootstrap", async (_req, res) => {
    const { rows: attempts } = await pool.query(
      "SELECT id,status,started_at,deadline FROM attempts WHERE owner=$1 ORDER BY started_at DESC LIMIT 20",
      [res.locals.owner],
    );
    res.json({ problem, attempts, runnerConfigured: runnerConfigured() });
  });
  app.post("/api/attempts", async (req, res) => {
    z.object({ acknowledged: z.literal(true) }).parse(req.body);
    const id = await createAttempt(res.locals.owner);
    res.status(201).json(await getAttempt(id, res.locals.owner));
  });
  app.get("/api/attempts/:id", async (req, res) =>
    res.json(await getAttempt(uuid.parse(req.params.id), res.locals.owner)),
  );
  app.put("/api/attempts/:id/draft", async (req, res) => {
    const body = z.object({ code, revision }).parse(req.body);
    const result = await saveDraft(
      uuid.parse(req.params.id),
      res.locals.owner,
      body.code,
      body.revision,
    );
    if (result.closed)
      return res.status(409).json({
        error:
          "The assessment has ended. Your last acknowledged draft was submitted.",
      });
    res.json(result);
  });
  app.put("/api/attempts/:id/language", async (req, res) => {
    const body = z
      .object({ language: z.enum(["python", "cpp", "java"]), revision })
      .parse(req.body);
    const id = uuid.parse(req.params.id);
    await changeLanguage(id, res.locals.owner, body.language, body.revision);
    res.json(await getAttempt(id, res.locals.owner));
  });
  app.post("/api/attempts/:id/runs", async (req, res) => {
    const body = z
      .object({ code, revision: revision.optional() })
      .parse(req.body);
    res.status(202).json({
      id: await runCode(
        uuid.parse(req.params.id),
        res.locals.owner,
        body.code,
        body.revision,
      ),
    });
  });
  app.post("/api/attempts/:id/submit", async (req, res) => {
    const body = z.object({ key: uuid, revision }).parse(req.body);
    const id = uuid.parse(req.params.id);
    await submit(id, res.locals.owner, body.key, body.revision);
    res.status(202).json(await getAttempt(id, res.locals.owner));
  });
  app.post("/api/attempts/:id/monitoring/sessions", async (req, res) => {
    const body = z.object({ sessionId: uuid }).strict().parse(req.body);
    res
      .status(201)
      .json(
        await startMonitoring(
          uuid.parse(req.params.id),
          res.locals.owner,
          body.sessionId,
        ),
      );
  });
  app.post("/api/attempts/:id/events/batch", async (req, res) => {
    const body = batchSchema.parse(req.body);
    res.json(
      await ingestEvents(
        uuid.parse(req.params.id),
        res.locals.owner,
        body.events,
      ),
    );
  });
  app.get("/api/attempts/:id/monitoring", async (req, res) =>
    res.json(
      await monitoringReport(uuid.parse(req.params.id), res.locals.owner),
    ),
  );
  app.post("/api/attempts/:id/camera/sessions", async (req, res) =>
    res
      .status(201)
      .json(
        await startCamera(
          uuid.parse(req.params.id),
          res.locals.owner,
          cameraConsent.parse(req.body),
        ),
      ),
  );
  app.post("/api/attempts/:id/camera/stop", async (req, res) =>
    res.json(
      await stopCamera(
        uuid.parse(req.params.id),
        res.locals.owner,
        z.object({ sessionId: uuid }).strict().parse(req.body).sessionId,
      ),
    ),
  );
  app.post("/api/attempts/:id/camera/batch", async (req, res) =>
    res.json(
      await ingestCamera(
        uuid.parse(req.params.id),
        res.locals.owner,
        cameraBatch.parse(req.body).observations,
      ),
    ),
  );
  app.get("/api/attempts/:id/camera", async (req, res) =>
    res.json(await cameraReport(uuid.parse(req.params.id), res.locals.owner)),
  );
  app.post("/api/attempts/:id/camera/evidence", async (req, res) => {
    const b = z
      .object({
        observationId: uuid,
        jpeg: z
          .string()
          .max(64000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(req.body);
    res.json(
      await saveEvidence(
        uuid.parse(req.params.id),
        res.locals.owner,
        b.observationId,
        b.jpeg,
      ),
    );
  });
  app.delete("/api/attempts/:id/camera/evidence", async (req, res) =>
    res.json(await deleteEvidence(uuid.parse(req.params.id), res.locals.owner)),
  );
  app.get("/api/attempts/:id/camera/evidence/:evidenceId", async (req, res) => {
    res
      .type("image/jpeg")
      .send(
        await readEvidence(
          uuid.parse(req.params.id),
          res.locals.owner,
          uuid.parse(req.params.evidenceId),
        ),
      );
  });
  app.post("/api/attempts/:id/screen/sessions", async (req, res) =>
    res
      .status(201)
      .json(
        await startScreen(
          uuid.parse(req.params.id),
          res.locals.owner,
          screenConsent.parse(req.body),
        ),
      ),
  );
  app.post("/api/attempts/:id/screen/stop", async (req, res) =>
    res.json(
      await stopScreen(
        uuid.parse(req.params.id),
        res.locals.owner,
        screenStop.parse(req.body),
      ),
    ),
  );
  app.post("/api/attempts/:id/screen/captures", async (req, res) =>
    res.json(
      await captureScreen(
        uuid.parse(req.params.id),
        res.locals.owner,
        screenCapture.parse(req.body),
      ),
    ),
  );
  app.get("/api/attempts/:id/screen", async (req, res) =>
    res.json(await screenReport(uuid.parse(req.params.id), res.locals.owner)),
  );
  app.get("/api/attempts/:id/screen/evidence/:evidenceId", async (req, res) =>
    res
      .type("image/jpeg")
      .send(
        await readScreen(
          uuid.parse(req.params.id),
          res.locals.owner,
          uuid.parse(req.params.evidenceId),
        ),
      ),
  );
  app.delete("/api/attempts/:id/screen/evidence", async (req, res) =>
    res.json(await deleteScreen(uuid.parse(req.params.id), res.locals.owner)),
  );
  app.post("/api/attempts/:id/retry", async (req, res) => {
    await retryGrading(uuid.parse(req.params.id), res.locals.owner);
    res.status(202).json({ ok: true });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: "Invalid request. Check code size and required fields.",
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (
        error.type === "entity.parse.failed" ||
        error.type === "entity.too.large"
      )
        return res.status(400).json({ error: "Invalid or oversized request." });
      console.error("Request failed:", error.code || error.name);
      res.status(500).json({
        error:
          "The server could not complete the request. Your acknowledged draft remains saved.",
      });
    },
  );
  return app;
}
