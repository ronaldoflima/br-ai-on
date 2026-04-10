import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const REPO = "ronaldoflima/br-ai-on";
const GITHUB_API = `https://api.github.com/repos/${REPO}/tags`;

let cache: { version: string | null; ts: number } = { version: null, ts: 0 };
const TTL = 10 * 60 * 1000;

function parseSemver(v: string): [number, number, number] {
  const parts = v.split(".").map((p) => parseInt(p, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function semverGt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

export async function GET() {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
  const current = pkg.version as string;

  let latest: string | null = null;
  const now = Date.now();

  if (cache.version && now - cache.ts < TTL) {
    latest = cache.version;
  } else {
    try {
      const res = await fetch(GITHUB_API, {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 600 },
      });
      if (res.ok) {
        const tags = await res.json();
        if (tags.length > 0) {
          latest = (tags[0].name as string).replace(/^v/, "");
          cache = { version: latest, ts: now };
        }
      }
    } catch {}
  }

  return NextResponse.json({
    current,
    latest,
    hasUpdate: latest ? semverGt(latest, current) : false,
    repo: `https://github.com/${REPO}`,
  });
}
