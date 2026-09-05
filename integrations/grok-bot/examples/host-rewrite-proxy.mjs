#!/usr/bin/env node

/**
 * Minimal host-rewrite proxy for remote MCP paths.
 *
 * Example usage:
 *   HARNESS_MEM_GROK_PROXY_TARGET_URL="http://127.0.0.1:37889" \
 *   HARNESS_MEM_GROK_PROXY_UPSTREAM_HOST="127.0.0.1:37889" \
 *   HARNESS_MEM_GROK_PROXY_PORT="37990" \
 *   node integrations/grok-bot/examples/host-rewrite-proxy.mjs
 *
 * Then publish with Tailscale Serve (example):
 *   tailscale serve --https=443 / http://127.0.0.1:37990
 */

import http from "node:http";
import https from "node:https";

const targetBase = new URL(
  process.env.HARNESS_MEM_GROK_PROXY_TARGET_URL || "http://127.0.0.1:37889"
);
const upstreamHost = process.env.HARNESS_MEM_GROK_PROXY_UPSTREAM_HOST || "127.0.0.1:37889";
const listenHost = process.env.HARNESS_MEM_GROK_PROXY_HOST || "127.0.0.1";
const listenPort = Number.parseInt(process.env.HARNESS_MEM_GROK_PROXY_PORT || "37990", 10);
const transport = targetBase.protocol === "https:" ? https : http;

if (!Number.isFinite(listenPort) || listenPort <= 0 || listenPort > 65535) {
  throw new Error(`Invalid HARNESS_MEM_GROK_PROXY_PORT: ${listenPort}`);
}

const server = http.createServer((req, res) => {
  const upstreamUrl = new URL(req.url || "/", targetBase);
  const headers = {
    ...req.headers,
    host: upstreamHost,
  };

  const proxyReq = transport.request(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (error) => {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: "upstream_request_failed",
        detail: String(error.message || error),
      })
    );
  });

  req.pipe(proxyReq);
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    `[grok-host-rewrite-proxy] listening on http://${listenHost}:${listenPort}, forwarding to ${targetBase.origin} with Host=${upstreamHost}\n`
  );
});
