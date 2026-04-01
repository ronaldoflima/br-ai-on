import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const REPO = "(usuário)flima/br-ai-on";
const GITHUB_API = `https://api.github.com/repos/${REPO}/tags`;

let cache: { version: string | null; ts: number } = { version: null, ts: 0 };
const TTL = 10 * 60 * 1000;

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
    hasUpdate: latest ? latest !== current : false,
    repo: `https://github.com/${REPO}`,
  });
}
