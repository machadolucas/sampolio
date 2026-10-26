/** Aggregate static chunk sizes, not first-load or per-route transfer sizes. */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export function measureStaticBundles(directory) {
  const result = Object.fromEntries(
    [".js", ".css"].map((extension) => [
      extension,
      { files: 0, raw_bytes: 0, gzip_bytes: 0 },
    ]),
  );
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && result[extname(entry.name)]) {
        const bytes = readFileSync(target);
        const item = result[extname(entry.name)];
        item.files++;
        item.raw_bytes += bytes.length;
        item.gzip_bytes += gzipSync(bytes, { level: 9 }).length;
      }
    }
  }
  visit(directory);
  return result;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      measureStaticBundles(resolve(process.argv[2] ?? ".next/static")),
      null,
      2,
    ),
  );
}
