'use strict';

const Anthropic = require('@anthropic-ai/sdk');

/**
 * Anthropic (Claude) adapter - reads only.
 *
 * Claude does not generate images, so this provider is offered for the body
 * read and the measurement sanity check and is absent from the image picker.
 * Saying that plainly beats letting a tailor select it for renders and watch
 * every one fail.
 */

const DEFAULT_MODEL = 'claude-opus-5';

class ProviderError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function translate(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError('Anthropic rejected that API key.', { status: 401, code: 'bad_key' });
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new ProviderError('That Claude model is not available on this key. Pick another in Settings.', { status: 404, code: 'no_model' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('Anthropic rate-limited the request. Wait a moment and try again.', { status: 429, code: 'rate_limit', retryable: true });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach Anthropic. Check the internet connection.', { code: 'offline', retryable: true });
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(err.message || `Anthropic request failed (HTTP ${err.status})`, {
      status: err.status,
      code: err.status >= 500 ? 'server' : 'api',
      retryable: err.status >= 500,
    });
  }
  return new ProviderError(err?.message ?? String(err), { code: 'api' });
}

const client = (apiKey) => {
  if (!apiKey) throw new ProviderError('No Anthropic API key set. Add one in Settings.', { code: 'no_key' });
  return new Anthropic({ apiKey });
};

module.exports = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  keyHint: 'sk-ant-...',
  docsUrl: 'https://console.anthropic.com/settings/keys',
  supportsImage: false,
  supportsVision: true,
  defaultVisionModel: DEFAULT_MODEL,

  async listModels(apiKey) {
    try {
      const page = await client(apiKey).models.list({ limit: 100 });
      const all = (page.data ?? []).map((m) => ({
        name: m.id,
        displayName: m.display_name ?? m.id,
        description: '',
        methods: ['generateContent'],
      }));
      // Every Claude model reads images; none of them draw one.
      return { all, image: [], vision: all, other: [] };
    } catch (err) {
      throw translate(err);
    }
  },

  async generateImage() {
    throw new ProviderError(
      'Claude cannot generate images. Choose Gemini or OpenAI as the image provider in Settings.',
      { code: 'not_image_model' }
    );
  },

  async analyse({ apiKey, model = DEFAULT_MODEL, prompt, images = [], schema }) {
    const content = [
      ...images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mime || 'image/jpeg', data: img.base64 },
      })),
      {
        type: 'text',
        text: schema
          ? `${prompt}\n\nReply with JSON only - no prose, no code fence - matching this shape:\n${JSON.stringify(schema)}`
          : prompt,
      },
    ];

    let response;
    try {
      response = await client(apiKey).messages.create({
        model,
        max_tokens: 16000,
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      throw translate(err);
    }

    // A safety decline arrives as a normal 200 response, so it has to be read
    // off stop_reason rather than caught.
    if (response.stop_reason === 'refusal') {
      throw new ProviderError('Claude declined to answer this request.', { code: 'refused' });
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) throw new ProviderError('Claude returned an empty response.', { code: 'empty', retryable: true });
    if (!schema) return { text };

    try {
      return { text, data: JSON.parse(text) };
    } catch {
      const match = /\{[\s\S]*\}/.exec(text);
      if (match) {
        try { return { text, data: JSON.parse(match[0]) }; } catch { /* fall through */ }
      }
      throw new ProviderError('Could not read the analysis Claude returned.', { code: 'parse' });
    }
  },

  async testKey(apiKey) {
    const models = await this.listModels(apiKey);
    return { ok: true, modelCount: models.all.length, imageModels: [] };
  },
};
