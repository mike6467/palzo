import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, serve the React frontend from the pre-built static files.
// The frontend is built to artifacts/pi-forwarder/dist/public relative to
// the repo root, which is the working directory when Render starts the server.
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.resolve(process.cwd(), "artifacts/pi-forwarder/dist/public");
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA fallback — serve index.html for any non-API route (Express 5 syntax)
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    logger.warn({ frontendDist }, "Frontend dist not found — skipping static file serving");
  }
}

export default app;
