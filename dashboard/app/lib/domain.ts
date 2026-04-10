export function parseDomainTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function getAvailableTags(
  allAgentTags: string[][],
  selected: Set<string>,
): string[] {
  if (selected.size === 0) {
    const all = allAgentTags.flat();
    return [...new Set(all)].sort();
  }
  const matchingAgentTags = allAgentTags.filter((tags) =>
    [...selected].every((s) => tags.includes(s)),
  );
  const available = matchingAgentTags.flat();
  return [...new Set(available)].sort();
}
