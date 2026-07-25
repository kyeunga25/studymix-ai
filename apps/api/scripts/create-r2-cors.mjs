import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const rawOrigins = process.env.DEPLOY_ALLOWED_WEB_ORIGINS ?? "";
const origins = rawOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (origins.length === 0 || origins.length > 10) {
  throw new Error("DEPLOY_ALLOWED_WEB_ORIGINS must contain between 1 and 10 origins.");
}

for (const origin of origins) {
  const url = new URL(origin);
  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !isLocalHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Every allowed web origin must be an HTTPS origin or local HTTP origin.");
  }
}

const policy = {
  rules: [
    {
      allowed: {
        origins,
        methods: ["PUT", "GET", "HEAD"],
        headers: ["Content-Type", "If-None-Match"],
      },
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3600,
    },
  ],
};

writeFileSync(resolve("wrangler.r2-cors.json"), `${JSON.stringify(policy, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write("Strict R2 CORS policy prepared.\n");
