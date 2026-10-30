import "reflect-metadata";
import { Module, Catch, type ExceptionFilter, type ArgumentsHost, HttpException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { createDatabase, migrate } from "./db.js";
import { bootstrap } from "./bootstrap.js";
import { ApiController } from "./api.js";
import { AppError } from "./accounting.js";
import { authenticate } from "./auth.js";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const preview = process.env.DEV_EMBEDDED_DB === "1";
if (preview && process.env.NODE_ENV === "production")
  throw new Error("Embedded preview database is disabled in production.");
const db = await createDatabase({
  url: process.env.DATABASE_URL,
  embedded: preview ? fileURLToPath(new URL("../.data/preview", import.meta.url)) : false
});
await migrate(db);
await bootstrap(
  db,
  {
  demo: process.env.DEMO_MODE === "true",
  seed: process.env.SEED_DEMO === "true",
  email: process.env.ADMIN_EMAIL || "",
  password: process.env.ADMIN_PASSWORD || ""
}
);
@Catch()
class Errors implements ExceptionFilter {
  catch(
    error: any,
    host: ArgumentsHost
  ) { const res = host.switchToHttp().getResponse(); let status = 500, message = "The request could not be completed."; if (error instanceof AppError) {
    status = error.status;
    message = error.message;
  }
  else if (error instanceof ZodError) {
    status = 400;
    message = error.issues.map(x => x.path.join(".") + ": " + x.message).join("; ");
  }
  else if (error instanceof HttpException) {
    status = error.getStatus();
    message = error.message;
  }
  else if (error.code === "23505") {
    status = 409;
    message = "A record with these details already exists.";
  }
  else if (error.code === "23503") {
    status = 400;
    message = "A referenced account, party or project was not found.";
  }
  else if (error.code === "23514") {
    status = 400;
    message = "The entry violates an accounting constraint.";
  }
  else
    console.error("API failure", error.code || error.name); res.status(status).json({ message }); }
}
@Module({ controllers: [ApiController], providers: [{ provide: "DB", useValue: db }] })
class AppModule {
}
const app = await NestFactory.create(AppModule, { logger: ["error", "warn"], bodyParser: false });
app.use(json({ limit: "4mb" }));
// Requests arrive through the Next.js proxy; trust it so req.ip is the browser's address, not the proxy's for everyone.
app.getHttpAdapter().getInstance().set("trust proxy", process.env.TRUST_PROXY || "loopback, uniquelocal");
app.useGlobalFilters(new Errors());
const attempts = new Map<string, {
  n: number;
  until: number
}>();
app.use(async (
  req: any,
  res: any,
  next: any
) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  try {
    const publicPaths = ["/api/health", "/api/auth/mode", "/api/auth/login", "/api/auth/demo"];
    if (publicPaths.includes(req.path)) {
      if (req.method === "POST") {
        // Limit per client address and, for sign-in, per account, so one source cannot lock out every user.
        const limits: [string, number][] = [["ip:" + (req.ip || "local"), 20]];
        if (req.path === "/api/auth/login" && typeof req.body?.email === "string")
          limits.push(["email:" + req.body.email.trim().toLowerCase(), 10]);
        if (attempts.size > 10000)
          attempts.clear();
        let limited = false;
        for (const [key, max] of limits) {
          let a = attempts.get(key);
          if (!a || a.until < Date.now())
            a = { n: 0, until: Date.now() + 60000 };
          a.n++;
          attempts.set(key, a);
          limited ||= a.n > max;
        }
        if (limited)
          return res.status(429).json({ message: "Too many sign-in attempts. Try again in a minute." });
      }
      return next();
    }
    const user = await authenticate(db, req);
    if (!user)
      return res.status(401).json({ message: "Please sign in." });
    req.user = user;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-csrf-token"] !== user.csrf)
      return res.status(403).json({ message: "Your session token changed. Reload and try again." });
    next();
  }
  catch {
    res.status(500).json({ message: "Authentication service unavailable." });
  }
});
app.enableShutdownHooks();
await app.listen(Number(process.env.API_PORT || process.env.PORT || 4000), "0.0.0.0");
console.log("Accounts API ready");
