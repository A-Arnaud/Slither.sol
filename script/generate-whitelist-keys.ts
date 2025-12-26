import "dotenv/config";
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { storage } from "../server/storage";

const countArg = process.argv[2];
const count = Number.isFinite(Number(countArg)) ? Number(countArg) : 100;

function makeKey() {
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `SLITH-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

async function main() {
  const outputPath = path.resolve(process.cwd(), "whitelist-keys.txt");
  const existing = new Set<string>();
  if (existsSync(outputPath)) {
    const content = readFileSync(outputPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    content.forEach((line) => existing.add(line));
  }

  const keys = new Set<string>(existing);
  while (keys.size < count) {
    keys.add(makeKey());
  }
  const list = Array.from(keys);
  await storage.createWhitelistKeys(list);

  writeFileSync(outputPath, list.join("\n"), "utf8");
  console.log(`Saved ${list.length} keys -> ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
