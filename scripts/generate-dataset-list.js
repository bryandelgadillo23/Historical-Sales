import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");
const outputFile = path.join(publicDir, "dataset-list.json");

const toIso = (date) => (date instanceof Date ? date.toISOString() : null);

async function main() {
  let entries;
  try {
    entries = await fs.readdir(publicDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Unable to read public directory: ${publicDir}`);
    throw err;
  }

  const datasets = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".csv")) continue;
    const filePath = path.join(publicDir, entry.name);
    const stats = await fs.stat(filePath);
    datasets.push({
      file: entry.name,
      size: stats.size,
      lastModified: toIso(stats.mtime),
    });
  }

  datasets.sort((a, b) => a.file.localeCompare(b.file));

  await fs.writeFile(
    outputFile,
    `${JSON.stringify({ datasets }, null, 2)}\n`,
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
