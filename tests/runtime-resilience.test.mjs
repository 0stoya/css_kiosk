import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("kiosk health route is dependency-free and explicitly non-cacheable", () => {
  const health = source("app/api/health/route.ts");

  assert.match(health, /status:\s*"ok"/);
  assert.match(health, /service:\s*"css-kiosk"/);
  assert.match(health, /Cache-Control/);
  assert.doesNotMatch(health, /fetch\(/);
  assert.doesNotMatch(health, /KIOSK_DB_PATH/);
});

test("kiosk stays single-instance and backs off restart loops", () => {
  const ecosystem = source("ecosystem.config.cjs");

  assert.match(ecosystem, /instances:\s*1/);
  assert.match(ecosystem, /max_memory_restart:\s*"512M"/);
  assert.match(ecosystem, /exp_backoff_restart_delay:\s*100/);
  assert.match(ecosystem, /NODE_ENV:\s*"production"/);
});
