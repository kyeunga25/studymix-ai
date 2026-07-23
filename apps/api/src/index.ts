import { Hono } from "hono";

export const app = new Hono();

app.get("/api/health", (context) =>
  context.json({
    data: {
      service: "studymix-api",
      status: "ok",
    },
    error: null,
    requestId: "foundation-health",
  }),
);

export default app;
