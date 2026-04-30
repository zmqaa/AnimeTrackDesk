const DEFAULT_AI_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_AI_MODEL = 'deepseek-chat';

function normalizeAiApiUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return DEFAULT_AI_URL;
  }

  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  if (/ark\.cn-[^.]+\.volces\.com\/api\/v\d+$/i.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}/chat/completions`;
  }

  return withoutTrailingSlash;
}

function shouldUseJsonFormat(apiUrl, model) {
  const override = String(process.env.AI_JSON_FORMAT ?? '').trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(override)) {
    return false;
  }

  if (['true', '1', 'on', 'yes'].includes(override)) {
    return true;
  }

  if (String(apiUrl || '').includes('.volces.com') || String(model || '').toLowerCase().startsWith('ep-')) {
    return false;
  }

  return true;
}

function parseJsonFromAiContent(content) {
  const normalized = String(content || '').trim();
  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch {
    const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const fencedContent = fencedMatch?.[1]?.trim();
    if (fencedContent) {
      try {
        return JSON.parse(fencedContent);
      } catch {
        // Fall through to generic object extraction.
      }
    }

    const objectMatch = normalized.match(/\{[\s\S]*\}/);
    const objectContent = objectMatch?.[0]?.trim();
    if (!objectContent) {
      return null;
    }

    try {
      return JSON.parse(objectContent);
    } catch {
      return null;
    }
  }
}

function getAiApiKey() {
  return String(process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
}

function shouldDisableThinking(aiConfig) {
  if (String(process.env.AI_DISABLE_THINKING || '').trim().toLowerCase() === 'false') {
    return false;
  }

  const apiUrl = String(aiConfig?.apiUrl || '').trim().toLowerCase();
  const model = String(aiConfig?.model || '').trim().toLowerCase();
  return apiUrl.includes('dashscope.aliyuncs.com') || model.startsWith('qwen');
}

function createAiRuntimeConfig(overrides = {}) {
  const apiUrl = normalizeAiApiUrl(overrides.apiUrl ?? process.env.AI_API_URL);
  const modelInput = overrides.model ?? process.env.AI_MODEL;
  const model = String(modelInput || '').trim() || DEFAULT_AI_MODEL;
  const apiKeyInput = overrides.apiKey ?? getAiApiKey();
  const apiKey = String(apiKeyInput || '').trim();
  const hasDisableThinking = Object.prototype.hasOwnProperty.call(overrides, 'disableThinking');

  return {
    apiUrl,
    model,
    apiKey,
    disableThinking: hasDisableThinking ? Boolean(overrides.disableThinking) : shouldDisableThinking({ apiUrl, model }),
  };
}

async function requestAiJson(options = {}) {
  const runtime = createAiRuntimeConfig({
    apiUrl: options.apiUrl,
    model: options.model,
    apiKey: options.apiKey,
    disableThinking: options.disableThinking,
  });

  if (!runtime.apiKey || !Array.isArray(options.messages) || options.messages.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody = {
    model: runtime.model,
    messages: options.messages,
    temperature: typeof options.temperature === 'number' ? options.temperature : 0.1,
    ...(shouldUseJsonFormat(runtime.apiUrl, runtime.model) ? { response_format: { type: 'json_object' } } : {}),
    ...(options.includeThinkingControl && runtime.disableThinking ? { enable_thinking: false } : {}),
    ...(options.extraBody && typeof options.extraBody === 'object' ? options.extraBody : {}),
  };

  try {
    const response = await fetch(runtime.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      ...(options.cache ? { cache: options.cache } : {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('AI request failed:', response.status, detail);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return null;
    }

    return parseJsonFromAiContent(content);
  } catch (error) {
    console.error('AI request error:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_URL,
  createAiRuntimeConfig,
  getAiApiKey,
  normalizeAiApiUrl,
  parseJsonFromAiContent,
  requestAiJson,
  shouldDisableThinking,
  shouldUseJsonFormat,
};