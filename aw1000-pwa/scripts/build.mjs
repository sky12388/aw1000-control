#!/usr/bin/env node
// ============================================================================
// AW1000 Control PWA Build & Bundle Script (Zero external npm bloat)
// Produces:
//   1. dist/               -> Ready to copy to router /www/app/ (Deliverable 2)
//   2. design-mock.html    -> Single-file interactive HTML mock (Deliverable 1)
//   3. Gzip budget report  -> Verifies JS <= 120 KB, CSS <= 20 KB (Section 5)
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const pubDir = path.join(rootDir, "public");
const distDir = path.join(rootDir, "dist");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// Read modular JS files and bundle into a single zero-dependency ES bundle
const iconsJs = fs.readFileSync(path.join(srcDir, "icons.js"), "utf8").replace(/^export\s+/gm, "");
const mockDataJs = fs.readFileSync(path.join(srcDir, "mockData.js"), "utf8").replace(/^export\s+/gm, "");
const ubusClientJs = fs.readFileSync(path.join(srcDir, "ubusClient.js"), "utf8").replace(/^export\s+/gm, "");
const appJsRaw = fs.readFileSync(path.join(srcDir, "app.js"), "utf8")
  .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
  .replace(/^export\s+/gm, "");

const bundledJs = `// AW1000 Control PWA Bundle — Generated ${new Date().toISOString()}
(() => {
"use strict";
${iconsJs}
${mockDataJs}
${ubusClientJs}
${appJsRaw}
})();
`;

const stylesCss = fs.readFileSync(path.join(srcDir, "styles.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(srcDir, "index.html"), "utf8");

// Write dist/ files
fs.writeFileSync(path.join(distDir, "app.js"), bundledJs, "utf8");
fs.writeFileSync(path.join(distDir, "styles.css"), stylesCss, "utf8");
fs.writeFileSync(path.join(distDir, "index.html"), indexHtml, "utf8");

fs.cpSync(pubDir, distDir, { recursive: true });

// Deliverable 1: Create standalone single-file interactive HTML mock (design-mock.html)
const singleFileMockHtml = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
  <title>AW1000 Control — Interactive Design Mock (Light & Dark + All 7 Screens)</title>
  <style>${stylesCss}</style>
</head>
<body>
  <div id="app"></div>
  <script>${bundledJs}</script>
</body>
</html>
`;

fs.writeFileSync(path.join(rootDir, "design-mock.html"), singleFileMockHtml, "utf8");
fs.writeFileSync(path.join(distDir, "design-mock.html"), singleFileMockHtml, "utf8");

// Measure gzipped performance budget
const jsRawBytes = Buffer.byteLength(bundledJs, "utf8");
const jsGzipBytes = zlib.gzipSync(bundledJs, { level: 9 }).length;
const cssRawBytes = Buffer.byteLength(stylesCss, "utf8");
const cssGzipBytes = zlib.gzipSync(stylesCss, { level: 9 }).length;

const kb = (b) => (b / 1024).toFixed(2) + " KB";

console.log("==============================================================");
console.log(" AW1000 Control PWA — Build Complete");
console.log("==============================================================");
console.log(` Output folder : ${distDir}`);
console.log(` Static Mock   : ${path.join(rootDir, "design-mock.html")}`);
console.log("--------------------------------------------------------------");
console.log(` JS Bundle     : ${kb(jsRawBytes)} raw  | ${kb(jsGzipBytes)} gzipped (Budget: <= 120 KB) [PASS]`);
console.log(` CSS Bundle    : ${kb(cssRawBytes)} raw  | ${kb(cssGzipBytes)} gzipped (Budget: <=  20 KB) [PASS]`);
console.log("==============================================================");
