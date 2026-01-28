#!/usr/bin/env node
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import fs from "node:fs";
import os from "node:os";

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

// Dependencies (same as react-router-serve)
const express = (await import("express")).default;
const compression = (await import("compression")).default;
const morgan = (await import("morgan")).default;
const getPort = (await import("get-port")).default;
const sourceMapSupport = (await import("source-map-support")).default;
const { createRequestHandler } = await import("@react-router/express");
const { createRequestListener } = await import("@mjackson/node-fetch-server");

sourceMapSupport.install({
  retrieveSourceMap(source) {
    if (typeof source !== "string" || !source.startsWith("file://")) return null;
    try {
      const filePath = fileURLToPath(source);
      const mapPath = `${filePath}.map`;
      if (fs.existsSync(mapPath)) {
        return { url: source, map: fs.readFileSync(mapPath, "utf8") };
      }
    } catch (_) {}
    return null;
  },
});

function isRSCServerBuild(build) {
  return Boolean(
    typeof build === "object" &&
      build &&
      "default" in build &&
      typeof build.default === "object" &&
      build.default &&
      "fetch" in build.default &&
      typeof build.default.fetch === "function"
  );
}

function parseNumber(raw) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

async function run() {
  const port = parseNumber(process.env.PORT) ?? (await getPort({ port: 3000 }));
  const buildPathArg = process.argv[2] || "./build/server/index.js";
  const buildPath = resolve(buildPathArg);

  const buildModule = await import(pathToFileURL(buildPath).href);
  let build;
  let isRSCBuild = false;

  if ((isRSCBuild = isRSCServerBuild(buildModule))) {
    const config = {
      publicPath: "/",
      assetsBuildDirectory: "../client",
      ...(buildModule.unstable_reactRouterServeConfig || {}),
    };
    build = {
      fetch: buildModule.default.fetch,
      publicPath: config.publicPath,
      assetsBuildDirectory: resolve(dirname(buildPath), config.assetsBuildDirectory),
    };
  } else {
    build = buildModule;
  }

  const onListen = () => {
    const address =
      process.env.HOST ||
      Object.values(os.networkInterfaces())
        .flat()
        .find((ip) => String(ip?.family).includes("4") && !ip?.internal)?.address;
    if (!address) {
      console.log(`[react-router-serve] http://localhost:${port}`);
    } else {
      console.log(`[react-router-serve] http://localhost:${port} (http://${address}:${port})`);
    }
  };

  const app = express();
  app.disable("x-powered-by");
  if (!isRSCBuild) {
    app.use(compression());
  }
  app.use(
    join(build.publicPath, "assets"),
    express.static(join(build.assetsBuildDirectory, "assets"), { immutable: true, maxAge: "1y" })
  );
  app.use(build.publicPath, express.static(build.assetsBuildDirectory));
  app.use(express.static("public", { maxAge: "1h" }));
  app.use(morgan("tiny"));

  if (build.fetch) {
    app.all("*", createRequestListener(build.fetch));
  } else {
    app.all(
      "*",
      createRequestHandler({ build: buildModule, mode: process.env.NODE_ENV })
    );
  }

  const server = process.env.HOST
    ? app.listen(port, process.env.HOST, onListen)
    : app.listen(port, onListen);

  ["SIGTERM", "SIGINT"].forEach((sig) => {
    process.once(sig, () => server?.close(console.error));
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
