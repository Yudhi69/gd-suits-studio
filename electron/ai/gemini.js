'use strict';

/**
 * Google Gemini adapter - the only network dependency in the app.
 *
 * Everything else (capture, spec, measurements, notes, pricing) works with no
 * connection at all; this module is reached only when the tailor explicitly
 * asks for a render or an AI opinion.
 */

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

const DEFAULTS = {
  imageModel: 'gemini-2.5-flash-image',
  visionModel: 'gemini-2.5-flash',
  timeoutMs: 120000,
};

class GeminiError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Turns transport and API failures into something a tailor can act on. */
function explain(status, body) {
  const apiMessage = body?.error?.message ?? '';
  if (status === 400 && /API key not valid/i.test(apiMessage)) {
    return new GeminiError('That API key was rejected. Check it in Settings.', { status, code: 'bad_key' });
  }
  if (status === 401 || status === 403) {
    return new GeminiError('The API key is missing permission for this model, or billing is not enabled on the Google account.', { status, code: 'forbidden' });
  }
  if (status === 404) {
    return new GeminiError(
      'That model is not available on this key. Open Settings > AI rendering and choose one from the list - it is loaded from your key, so everything in it will work.',
      { status, code: 'no_model' }
    );
  }
  if (status === 429) {
    return new GeminiError('Google rate-limited the request. Wait a moment and try again.', { status, code: 'rate_limit', retryable: true });
  }
  if (status >= 500) {
    return new GeminiError('Google had a server error. Try the render again.', { status, code: 'server', retryable: true });
  }
  return new GeminiError(apiMessage || `Request failed (HTTP ${status})`, { status, code: 'api' });
}

async function call(apiKey, model, body, { timeoutMs = DEFAULTS.timeoutMs } = {}) {
  if (!apiKey) throw new GeminiError('No API key set. Add one in Settings to use AI rendering.', { code: 'no_key' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GeminiError(`The render took longer than ${Math.round(timeoutMs / 1000)}s and was cancelled.`, { code: 'timeout', retryable: true });
    }
    throw new GeminiError('Could not reach Google. Check the internet connection - the rest of the app still works offline.', { code: 'offline', retryable: true });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* fall through to the status-based message */
  }

  if (!res.ok) throw explain(res.status, json);
  return json;
}

function imagePart(image) {
  return { inlineData: { mimeType: image.mime ?? 'image/jpeg', data: image.base64 } };
}

/** Lists the models this key can actually use, so Settings never guesses. */
async function listModels(apiKey) {
  if (!apiKey) throw new GeminiError('No API key set.', { code: 'no_key' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(`${API_ROOT}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
  } catch {
    throw new GeminiError('Could not reach Google to list models.', { code: 'offline', retryable: true });
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) throw explain(res.status, json);

  const models = (json?.models ?? []).map((m) => ({
    name: String(m.name ?? '').replace(/^models\//, ''),
    displayName: m.displayName ?? '',
    description: m.description ?? '',
    methods: m.supportedGenerationMethods ?? [],
  }));

  // This app calls :generateContent, so anything that does not support it
  // cannot be used no matter what it is named.
  const usable = models.filter((m) => m.methods.includes('generateContent'));

  // Named for the job in most cases, but not always - "nano-banana" is an
  // image model with no "image" in its name - so the description is checked
  // too rather than trusting the naming convention to hold.
  const isImage = (m) =>
    !/embedding/i.test(m.name) &&
    (/image|nano-?banana|imagen/i.test(m.name) || /image generation|generates images/i.test(m.description ?? ''));
  const isVision = (m) => /gemini/i.test(m.name) && !/image|embedding|tts|live|audio/i.test(m.name);

  const image = usable.filter(isImage);
  const vision = usable.filter(isVision);

  return {
    all: usable,
    image,
    vision,
    // Everything else that could still be selected by hand. Google renames
    // these families often, so the picker offers the full list as a fallback
    // rather than trapping the tailor behind a guess about naming.
    other: usable.filter((m) => !isImage(m) && !isVision(m)),
  };
}

/**
 * Generates a suit visualisation.
 * `images` are reference photos in prompt order (client, fabric, lining...).
 */
async function generateImage({ apiKey, model = DEFAULTS.imageModel, prompt, images = [], timeoutMs }) {
  const parts = [{ text: prompt }, ...images.map(imagePart)];

  let json;
  try {
    json = await call(
      apiKey,
      model,
      {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      },
      { timeoutMs }
    );
  } catch (err) {
    // Asking a text model for an image is answered with a 404, which reads as
    // "no such model" but actually means "that model cannot return one".
    // Saying so is the difference between a fixable message and a dead end.
    if (err.code === 'no_model') {
      throw new GeminiError(
        `"${model}" cannot produce images - it is a text model. Open Settings > AI rendering and choose one from the Image models group.`,
        { status: err.status, code: 'not_image_model' }
      );
    }
    throw err;
  }

  const candidate = json?.candidates?.[0];

  if (!candidate) {
    const blocked = json?.promptFeedback?.blockReason;
    throw new GeminiError(
      blocked
        ? `Google blocked the request (${blocked}). Try rewording the tailor's direction, or use a different reference photo.`
        : 'Google returned no result. Try again.',
      { code: 'empty', retryable: !blocked }
    );
  }

  const outParts = candidate.content?.parts ?? [];
  const image = outParts.find((p) => p.inlineData?.data);
  const notes = outParts.filter((p) => p.text).map((p) => p.text).join('\n').trim();

  if (!image) {
    const reason = candidate.finishReason;
    throw new GeminiError(
      reason === 'SAFETY'
        ? 'The safety filter blocked this render. A clearer, fully-clothed reference photo usually fixes it.'
        : `The model replied without an image${notes ? `: ${notes.slice(0, 300)}` : '.'}`,
      { code: 'no_image', retryable: true }
    );
  }

  return {
    base64: image.inlineData.data,
    mime: image.inlineData.mimeType ?? 'image/png',
    notes,
    model,
  };
}

/** Free-text or structured analysis over the client's photos. */
async function analyse({ apiKey, model = DEFAULTS.visionModel, prompt, images = [], schema, timeoutMs = 60000 }) {
  const parts = [{ text: prompt }, ...images.map(imagePart)];
  const generationConfig = schema
    ? { responseMimeType: 'application/json', responseSchema: schema }
    : {};

  const json = await call(apiKey, model, { contents: [{ role: 'user', parts }], generationConfig }, { timeoutMs });

  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.text)
    .map((p) => p.text)
    .join('')
    .trim();

  if (!text) throw new GeminiError('The model returned an empty response.', { code: 'empty', retryable: true });
  if (!schema) return { text };

  try {
    return { text, data: JSON.parse(text) };
  } catch {
    // A model occasionally wraps JSON in prose or a fence; salvage the object.
    const match = /\{[\s\S]*\}/.exec(text);
    if (match) {
      try {
        return { text, data: JSON.parse(match[0]) };
      } catch { /* fall through */ }
    }
    throw new GeminiError('Could not read the analysis the model returned.', { code: 'parse' });
  }
}

async function testKey(apiKey) {
  const models = await listModels(apiKey);
  return {
    ok: true,
    modelCount: models.all.length,
    imageModels: models.image.map((m) => m.name),
  };
}

module.exports = { DEFAULTS, GeminiError, listModels, generateImage, analyse, testKey };
