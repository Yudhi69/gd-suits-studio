'use strict';

/**
 * OpenAI adapter (also used for any OpenAI-compatible endpoint).
 *
 * Images come from the images endpoints rather than chat: `/images/edits` when
 * there are reference photographs to work from, `/images/generations` when
 * there are not. Vision reads go through chat completions.
 */

const DEFAULT_BASE = 'https://api.openai.com/v1';

class ProviderError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function explain(status, body, label = 'OpenAI') {
  const message = body?.error?.message ?? '';
  if (status === 401) return new ProviderError(`${label} rejected that API key.`, { status, code: 'bad_key' });
  if (status === 403) return new ProviderError(`${label} refused the request - the key may lack access to this model.`, { status, code: 'forbidden' });
  if (status === 404) return new ProviderError(`That model is not available on this ${label} key. Pick another in Settings.`, { status, code: 'no_model' });
  if (status === 429) {
    // OpenAI answers "no credits" with a 429 too, which reads as throttling
    // and sends people off to wait for something that will never clear.
    if (body?.error?.type === 'insufficient_quota' || /credit|quota|billing/i.test(message)) {
      return new ProviderError(
        `${label} has no API credit left. A ChatGPT Plus subscription does not fund API calls - they are billed separately. ` +
        'Add credit at platform.openai.com/settings/organization/billing, or switch the image provider to Gemini in Settings.',
        { status, code: 'no_credit' }
      );
    }
    return new ProviderError(`${label} rate-limited the request. Wait a moment and try again.`, { status, code: 'rate_limit', retryable: true });
  }
  if (status >= 500) return new ProviderError(`${label} had a server error. Try again.`, { status, code: 'server', retryable: true });
  return new ProviderError(message || `${label} request failed (HTTP ${status})`, { status, code: 'api' });
}

async function request(baseUrl, path, { apiKey, body, form, method = 'POST', timeoutMs = 120000, label }) {
  if (!apiKey) throw new ProviderError(`No ${label} API key set. Add one in Settings.`, { code: 'no_key' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(form ? {} : { 'content-type': 'application/json' }),
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderError(
      err.name === 'AbortError'
        ? `The ${label} request timed out.`
        : `Could not reach ${label}. Check the internet connection.`,
      { code: err.name === 'AbortError' ? 'timeout' : 'offline', retryable: true }
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* status-based message below */ }
  if (!res.ok) throw explain(res.status, json, label);
  return json;
}

function make({ id, label, baseUrl = DEFAULT_BASE, docsUrl, keyHint }) {
  return {
    id,
    label,
    keyHint,
    docsUrl,
    baseUrl,
    supportsImage: true,
    supportsVision: true,

    async listModels(apiKey) {
      const json = await request(baseUrl, '/models', { apiKey, method: 'GET', body: null, label, timeoutMs: 30000 });
      const all = (json?.data ?? []).map((m) => ({ name: m.id, displayName: m.id, description: '', methods: [] }));
      const isImage = (m) => /image|dall-?e/i.test(m.name);
      const isVision = (m) => /gpt-4|gpt-5|gpt-4o|o\d|vision/i.test(m.name) && !isImage(m) && !/embedding|whisper|tts|audio|moderation/i.test(m.name);
      return {
        all: all.filter((m) => !/embedding|whisper|tts|audio|moderation/i.test(m.name)),
        image: all.filter(isImage),
        vision: all.filter(isVision),
        other: all.filter((m) => !isImage(m) && !isVision(m)),
      };
    },

    async generateImage({ apiKey, model, prompt, images = [] }) {
      // With reference photographs the edit endpoint is the right one: it is
      // given the client and the cloth to work from rather than inventing them.
      if (images.length) {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        images.forEach((img, i) => {
          const bytes = Buffer.from(img.base64, 'base64');
          form.append('image[]', new Blob([bytes], { type: img.mime || 'image/png' }), `ref-${i}.png`);
        });
        const json = await request(baseUrl, '/images/edits', { apiKey, form, label });
        const b64 = json?.data?.[0]?.b64_json;
        if (!b64) throw new ProviderError(`${label} returned no image.`, { code: 'no_image', retryable: true });
        return { base64: b64, mime: 'image/png', notes: '', model };
      }

      const json = await request(baseUrl, '/images/generations', {
        apiKey,
        body: { model, prompt, n: 1, size: '1024x1536' },
        label,
      });
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError(`${label} returned no image.`, { code: 'no_image', retryable: true });
      return { base64: b64, mime: 'image/png', notes: '', model };
    },

    async analyse({ apiKey, model, prompt, images = [], schema }) {
      const content = [
        { type: 'text', text: schema ? `${prompt}\n\nReply with JSON only, matching this shape:\n${JSON.stringify(schema)}` : prompt },
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mime || 'image/jpeg'};base64,${img.base64}` },
        })),
      ];
      const json = await request(baseUrl, '/chat/completions', {
        apiKey,
        body: {
          model,
          messages: [{ role: 'user', content }],
          ...(schema ? { response_format: { type: 'json_object' } } : {}),
        },
        label,
        timeoutMs: 60000,
      });
      const text = json?.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) throw new ProviderError(`${label} returned an empty response.`, { code: 'empty', retryable: true });
      if (!schema) return { text };
      try { return { text, data: JSON.parse(text) }; } catch {
        const match = /\{[\s\S]*\}/.exec(text);
        if (match) { try { return { text, data: JSON.parse(match[0]) }; } catch { /* fall through */ } }
        throw new ProviderError(`Could not read the analysis ${label} returned.`, { code: 'parse' });
      }
    },

    async testKey(apiKey) {
      const models = await this.listModels(apiKey);
      return { ok: true, modelCount: models.all.length, imageModels: models.image.map((m) => m.name) };
    },
  };
}

module.exports = { make, ProviderError, DEFAULT_BASE };
