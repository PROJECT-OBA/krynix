import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const roots = ["README.md", "docs", "wiki"];

function listMarkdownFiles(target) {
  const abs = resolve(repoRoot, target);
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  const out = [];
  const stack = [abs];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const next = join(dir, name);
      const s = statSync(next);
      if (s.isDirectory()) {
        stack.push(next);
      } else if (s.isFile() && next.endsWith(".md")) {
        out.push(next);
      }
    }
  }
  return out;
}

const files = roots.flatMap(listMarkdownFiles);
const markdownLinkRe = /\[[^\]]+\]\(([^)]+)\)/g;
const wikiLinkRe = /\[\[([^\]]+)\]\]/g;
const broken = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");

  for (const match of content.matchAll(markdownLinkRe)) {
    const raw = match[1].trim();
    const link = raw.replace(/^<|>$/g, "");

    if (
      link.startsWith("http://") ||
      link.startsWith("https://") ||
      link.startsWith("mailto:") ||
      link.startsWith("tel:") ||
      link.startsWith("#") ||
      link.startsWith("data:")
    ) {
      continue;
    }

    const pathPart = link.split("#")[0];
    if (pathPart.length === 0) continue;

    const resolved = link.startsWith("/")
      ? resolve(repoRoot, `.${pathPart}`)
      : resolve(dirname(file), pathPart);

    if (!existsSync(resolved)) {
      broken.push(`${file}: ${link}`);
    }
  }

  for (const match of content.matchAll(wikiLinkRe)) {
    const raw = match[1].trim();
    if (raw.length === 0) continue;
    const target = raw.split("|")[0].trim();
    const candidates = [
      resolve(repoRoot, "wiki", `${target}.md`),
      resolve(repoRoot, "wiki", `${target.replace(/ /g, "-")}.md`),
    ];
    if (!candidates.some((c) => existsSync(c))) {
      broken.push(`${file}: [[${target}]]`);
    }
  }
}

if (broken.length > 0) {
  console.error("Broken markdown/wiki links found:");
  for (const b of broken) console.error(`- ${b}`);
  process.exit(1);
}

console.log(`Link check passed (${files.length} markdown files).`);
