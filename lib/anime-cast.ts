export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function normalizeStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((entry) => String(entry)));
  }

  if (typeof value === 'string') {
    return uniqueStrings(value.split(/[,，]/));
  }

  return undefined;
}

export function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((entry) => String(entry)));
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? uniqueStrings(parsed.map((entry) => String(entry))) : [];
  } catch {
    return [];
  }
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s'"`’‘.,，:：;；!！?？·・()（）\-_/\\\[\]{}]/g, '')
    .toLowerCase();
}

export function matchesTextQuery(
  query: string,
  ...candidateLists: Array<Array<string | undefined | null> | undefined>
): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return true;
  }

  const loweredQuery = trimmedQuery.toLowerCase();
  const normalizedQuery = normalizeSearchText(trimmedQuery);
  const candidates = uniqueStrings(candidateLists.flatMap((list) => list || []));

  return candidates.some((candidate) => {
    const loweredCandidate = candidate.toLowerCase();
    if (loweredCandidate.includes(loweredQuery)) {
      return true;
    }

    return normalizeSearchText(candidate).includes(normalizedQuery);
  });
}

export function containsCjkText(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(value);
}