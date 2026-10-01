import { build } from "vite";
import { gzipSync } from "node:zlib";

// Inspect the final Rollup output; no analyzer dependency or source maps.
const result = await build({ logLevel: "silent", build: { write: false } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const report = outputs.filter(item => item.type === "chunk").map(chunk => ({
  file: chunk.fileName,
  entry: chunk.isEntry,
  bytes: Buffer.byteLength(chunk.code),
  gzipBytes: gzipSync(chunk.code).length,
  imports: chunk.imports,
  dynamicImports: chunk.dynamicImports,
  // Contributions are before minification, not apportioned gzip sizes.
  largestModules: Object.entries(chunk.modules)
    .map(([id, module]) => ({ module: id.replace(process.cwd() + "/", ""), renderedBytes: module.renderedLength }))
    .sort((a, b) => b.renderedBytes - a.renderedBytes).slice(0, 10),
}));
console.log(JSON.stringify(report, null, 2));
