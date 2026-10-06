import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Kiosk production nginx is committed with HTTP/2 and streaming enabled", () => {
  const nginx = source("deploy/nginx/kiosk.csscdn.co.uk.conf");

  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3099;/);
  assert.match(nginx, /listen 443 ssl http2;/);
  assert.match(nginx, /listen \[::\]:443 ssl http2;/);
  assert.match(nginx, /proxy_buffering off;/);
  assert.match(nginx, /proxy_read_timeout 86400;/);
});
