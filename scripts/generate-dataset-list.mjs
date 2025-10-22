import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PUB = join(process.cwd(), "public");

function iso(dt) {
  return new Date(dt).toISOString();
}

function main() {
  const entries = readdirSync(PUB, { withFileTypes: true });
  const rows = [];

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (!/^historical_.*\.csv$/i.test(name)) continue;

    const fp = join(PUB, name);
    const st = statSync(fp);
    rows.push({
      file: name,
      size: st.size,
      lastModified: iso(st.mtimeMs || st.mtime || Date.now()),
    });
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));

  const out = { datasets: rows };
  const outPath = join(PUB, "dataset-list.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Wrote ${out.datasets.length} dataset(s) to ${outPath}`);
}

main();
