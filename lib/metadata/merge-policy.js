const MAX_METADATA_CAST_MEMBERS = 10;

const DEFAULT_METADATA_FIELDS = [
  'originalTitle',
  'coverUrl',
  'score',
  'totalEpisodes',
  'durationMinutes',
  'summary',
  'tags',
  'premiereDate',
  'cast',
  'castAliases',
  'isFinished',
];

const AI_CAPABLE_METADATA_FIELDS = new Set([
  'originalTitle',
  'coverUrl',
  'totalEpisodes',
  'durationMinutes',
  'summary',
  'tags',
  'premiereDate',
  'isFinished',
]);

const FIELD_SOURCE_PRIORITY = {
  originalTitle: ['provider', 'ai'],
  coverUrl: ['provider', 'ai'],
  score: ['provider'],
  totalEpisodes: ['provider', 'ai'],
  durationMinutes: ['ai', 'provider'],
  summary: ['ai', 'provider'],
  tags: ['ai', 'provider'],
  premiereDate: ['provider', 'ai'],
  cast: ['provider', 'ai'],
  castAliases: ['provider', 'ai'],
  isFinished: ['provider', 'ai'],
};

const ALL_METADATA_FIELDS = Object.keys(FIELD_SOURCE_PRIORITY);

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];

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

function containsCjkText(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function isBlank(value) {
  return typeof value !== 'string' || !value.trim();
}

function hasPlaceholderCover(value) {
  return typeof value === 'string' && /placeholder/i.test(value);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeDateString } = require('../date-utils.js');

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => (typeof item === 'string' ? item : String(item ?? ''))));
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return uniqueStrings(parsed.map((item) => (typeof item === 'string' ? item : String(item ?? ''))));
  } catch {
    return [];
  }
}

const normalizeMetadataDate = normalizeDateString;

function normalizeMetadataFieldValue(field, value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (field) {
    case 'originalTitle': {
      const text = String(value).trim();
      return text || undefined;
    }
    case 'coverUrl': {
      const text = String(value).trim();
      if (!text) {
        return undefined;
      }

      return text.replace(/^http:\/\//i, 'https://');
    }
    case 'summary': {
      const text = String(value).trim();
      if (!text) {
        return undefined;
      }

      if (/无法确定|信息不足|unknown/i.test(text)) {
        return undefined;
      }

      if (!containsCjkText(text)) {
        return undefined;
      }

      return text;
    }
    case 'score': {
      const score = Number(value);
      if (!Number.isFinite(score) || score <= 0 || score > 10) {
        return undefined;
      }

      return Number(score.toFixed(1));
    }
    case 'totalEpisodes':
    case 'durationMinutes': {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return undefined;
      }

      return Math.round(numeric);
    }
    case 'premiereDate':
      return normalizeMetadataDate(value);
    case 'tags': {
      const values = parseStringArray(value);
      return values.length > 0 ? values.slice(0, 20) : undefined;
    }
    case 'cast': {
      const values = parseStringArray(value);
      return values.length > 0 ? values.slice(0, MAX_METADATA_CAST_MEMBERS) : undefined;
    }
    case 'castAliases': {
      const values = parseStringArray(value);
      return values.length > 0 ? values.slice(0, 30) : undefined;
    }
    case 'isFinished':
      return typeof value === 'boolean' ? value : undefined;
    default:
      return undefined;
  }
}

function isMetadataFieldMissing(field, value) {
  if (field === 'summary') {
    return normalizeMetadataFieldValue(field, value) === undefined;
  }

  switch (field) {
    case 'originalTitle':
      return isBlank(value);
    case 'coverUrl':
      return isBlank(value) || hasPlaceholderCover(value);
    case 'score':
    case 'totalEpisodes':
    case 'durationMinutes': {
      const numeric = Number(value);
      return !Number.isFinite(numeric) || numeric <= 0;
    }
    case 'premiereDate':
      return !normalizeMetadataDate(value);
    case 'tags':
    case 'cast':
    case 'castAliases':
      return !Array.isArray(value) || value.length === 0;
    case 'isFinished':
      return value === null || value === undefined;
    default:
      return true;
  }
}

function sameString(left, right) {
  return String(left || '').trim() === String(right || '').trim();
}

function sameNumber(left, right) {
  if (left === undefined && right === undefined) {
    return true;
  }

  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }

  return Math.abs(a - b) < 0.0001;
}

function sameArray(left, right) {
  const a = uniqueStrings(Array.isArray(left) ? left : []).sort();
  const b = uniqueStrings(Array.isArray(right) ? right : []).sort();

  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

function sameBoolean(left, right) {
  if (left === undefined && right === undefined) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  return Boolean(left) === Boolean(right);
}

function sameMetadataFieldValue(field, left, right) {
  switch (field) {
    case 'originalTitle':
    case 'coverUrl':
    case 'summary':
      return sameString(left, right);
    case 'score':
    case 'totalEpisodes':
    case 'durationMinutes':
      return sameNumber(left, right);
    case 'premiereDate':
      return sameString(normalizeMetadataDate(left), normalizeMetadataDate(right));
    case 'tags':
    case 'cast':
    case 'castAliases':
      return sameArray(left, right);
    case 'isFinished':
      return sameBoolean(left, right);
    default:
      return false;
  }
}

function isStrictStringArraySuperset(nextValue, currentValue) {
  const next = uniqueStrings(Array.isArray(nextValue) ? nextValue : []);
  const current = uniqueStrings(Array.isArray(currentValue) ? currentValue : []);

  if (next.length <= current.length) {
    return false;
  }

  return current.every((item) => next.includes(item));
}

function normalizeSourceMetadata(source) {
  const value = source || {};

  return {
    originalTitle: normalizeMetadataFieldValue('originalTitle', value.originalTitle),
    coverUrl: normalizeMetadataFieldValue('coverUrl', value.coverUrl),
    score: normalizeMetadataFieldValue('score', value.score),
    totalEpisodes: normalizeMetadataFieldValue('totalEpisodes', value.totalEpisodes),
    durationMinutes: normalizeMetadataFieldValue('durationMinutes', value.durationMinutes),
    summary: normalizeMetadataFieldValue('summary', value.summary ?? value.synopsis ?? value.description),
    tags: normalizeMetadataFieldValue('tags', value.tags),
    premiereDate: normalizeMetadataFieldValue('premiereDate', value.premiereDate),
    cast: normalizeMetadataFieldValue('cast', value.cast),
    castAliases: normalizeMetadataFieldValue('castAliases', value.castAliases),
    isFinished: normalizeMetadataFieldValue('isFinished', value.isFinished),
  };
}

function pickPreferredValue(field, normalizedSources) {
  if (field === 'castAliases') {
    const providerAliases = Array.isArray(normalizedSources.provider.castAliases) ? normalizedSources.provider.castAliases : [];
    const aiAliases = Array.isArray(normalizedSources.ai.castAliases) ? normalizedSources.ai.castAliases : [];
    const mergedAliases = uniqueStrings([...providerAliases, ...aiAliases]);
    if (mergedAliases.length > 0) {
      return mergedAliases;
    }
  }

  for (const sourceName of FIELD_SOURCE_PRIORITY[field] || []) {
    const sourceValue = normalizedSources[sourceName]?.[field];
    if (sourceValue !== undefined) {
      return sourceValue;
    }
  }

  return undefined;
}

function resolveSourceLabel(field, normalizedSources, candidateValue) {
  if (field === 'castAliases') {
    const providerAliases = Array.isArray(normalizedSources.provider.castAliases) ? normalizedSources.provider.castAliases : [];
    const aiAliases = Array.isArray(normalizedSources.ai.castAliases) ? normalizedSources.ai.castAliases : [];
    if (providerAliases.length > 0 && aiAliases.length > 0) {
      return 'provider+ai';
    }
  }

  for (const sourceName of FIELD_SOURCE_PRIORITY[field] || []) {
    const sourceValue = normalizedSources[sourceName]?.[field];
    if (sourceValue !== undefined && sameMetadataFieldValue(field, sourceValue, candidateValue)) {
      return sourceName;
    }
  }

  return undefined;
}

function buildMetadataCandidate(provider, ai) {
  const normalizedSources = {
    provider: normalizeSourceMetadata(provider),
    ai: normalizeSourceMetadata(ai),
  };

  const candidate = {};
  const source = {};

  for (const field of ALL_METADATA_FIELDS) {
    const candidateValue = pickPreferredValue(field, normalizedSources);
    if (candidateValue === undefined) {
      continue;
    }

    candidate[field] = candidateValue;

    const sourceLabel = resolveSourceLabel(field, normalizedSources, candidateValue);
    if (sourceLabel) {
      source[field] = sourceLabel;
    }
  }

  return { candidate, source };
}

function fieldPrefersAi(field) {
  return FIELD_SOURCE_PRIORITY[field]?.[0] === 'ai';
}

function fieldSupportsAi(field) {
  return AI_CAPABLE_METADATA_FIELDS.has(field) && FIELD_SOURCE_PRIORITY[field]?.includes('ai');
}

function shouldUseAiForMetadata(current, providerCandidate, options = {}) {
  const fields = Array.isArray(options.fields) && options.fields.length > 0 ? options.fields : DEFAULT_METADATA_FIELDS;
  const force = Boolean(options.force);

  for (const field of fields) {
    if (!fieldSupportsAi(field)) {
      continue;
    }

    const currentValue = current?.[field];
    const providerValue = providerCandidate?.[field];

    if (force) {
      if (fieldPrefersAi(field)) {
        return true;
      }

      if (isMetadataFieldMissing(field, providerValue)) {
        return true;
      }

      continue;
    }

    if (!isMetadataFieldMissing(field, currentValue)) {
      continue;
    }

    if (fieldPrefersAi(field)) {
      return true;
    }

    if (isMetadataFieldMissing(field, providerValue)) {
      return true;
    }
  }

  return false;
}

function shouldUpdateMetadataField(field, currentValue, nextValue, options = {}) {
  if (nextValue === undefined) {
    return false;
  }

  if (options.force) {
    return !sameMetadataFieldValue(field, currentValue, nextValue);
  }

  const currentMissing = isMetadataFieldMissing(field, currentValue);
  if (!currentMissing) {
    if (field === 'isFinished' && options.allowIsFinishedUpgrade !== false && currentValue === false && nextValue === true) {
      return true;
    }

    if (field === 'castAliases' && options.allowCastAliasAugment !== false) {
      return isStrictStringArraySuperset(nextValue, currentValue) && !sameMetadataFieldValue(field, currentValue, nextValue);
    }

    if (field === 'coverUrl' && options.allowReplaceFilledCover) {
      return !sameMetadataFieldValue(field, currentValue, nextValue);
    }

    return false;
  }

  return !sameMetadataFieldValue(field, currentValue, nextValue);
}

function buildMetadataPatch(current, candidateLike, options = {}) {
  const fields = Array.isArray(options.fields) && options.fields.length > 0 ? options.fields : DEFAULT_METADATA_FIELDS;
  const candidate = candidateLike?.candidate || candidateLike || {};
  const source = candidateLike?.source || {};
  const patch = {};
  const sources = {};

  for (const field of fields) {
    const normalizedNext = normalizeMetadataFieldValue(field, candidate[field]);
    if (normalizedNext === undefined) {
      continue;
    }

    if (shouldUpdateMetadataField(field, current?.[field], normalizedNext, options)) {
      patch[field] = normalizedNext;
      if (source[field]) {
        sources[field] = source[field];
      }
    }
  }

  return { patch, sources };
}

function applyMetadataPatch(current, candidateLike, options = {}) {
  const { patch, sources } = buildMetadataPatch(current, candidateLike, options);
  return {
    data: {
      ...(current || {}),
      ...patch,
    },
    patch,
    sources,
  };
}

module.exports = {
  ALL_METADATA_FIELDS,
  AI_CAPABLE_METADATA_FIELDS,
  DEFAULT_METADATA_FIELDS,
  buildMetadataCandidate,
  buildMetadataPatch,
  applyMetadataPatch,
  isMetadataFieldMissing,
  normalizeMetadataDate,
  normalizeMetadataFieldValue,
  sameMetadataFieldValue,
  shouldUseAiForMetadata,
};