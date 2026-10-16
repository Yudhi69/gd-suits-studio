'use strict';

const gemini = require('./gemini');
const openai = require('./openai');
const anthropic = require('./anthropic');

/**
 * The providers the app can talk to.
 *
 * Each one exposes the same four calls - listModels, generateImage, analyse,
 * testKey - so the rest of the app never branches on which is configured.
 * Capability flags are honest: Claude reads images but cannot draw one, so it
 * simply does not appear in the image picker.
 */

/** Gemini predates the shared shape, so it is wrapped rather than rewritten. */
const geminiAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  keyHint: 'AIza...',
  docsUrl: 'https://aistudio.google.com/apikey',
  supportsImage: true,
  supportsVision: true,
  defaultImageModel: gemini.DEFAULTS.imageModel,
  defaultVisionModel: gemini.DEFAULTS.visionModel,
  listModels: (apiKey) => gemini.listModels(apiKey),
  generateImage: (args) => gemini.generateImage(args),
  analyse: (args) => gemini.analyse(args),
  testKey: (apiKey) => gemini.testKey(apiKey),
};

const openaiAdapter = {
  ...openai.make({
    id: 'openai',
    label: 'OpenAI',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  }),
  defaultImageModel: 'gpt-image-1',
  defaultVisionModel: 'gpt-4o',
};

/**
 * Anything that speaks the OpenAI wire format - OpenRouter, Together, a local
 * llama.cpp or Ollama server, an Azure deployment. The base URL is configured
 * by the tailor, which is the only thing that differs.
 */
function customAdapter(baseUrl) {
  return {
    ...openai.make({
      id: 'custom',
      label: 'Custom (OpenAI-compatible)',
      baseUrl: baseUrl || openai.DEFAULT_BASE,
      keyHint: 'key for that service',
      docsUrl: '',
    }),
    defaultImageModel: '',
    defaultVisionModel: '',
    needsBaseUrl: true,
  };
}

const BUILT_IN = [geminiAdapter, openaiAdapter, anthropic];

function all(customBaseUrl) {
  return [...BUILT_IN, customAdapter(customBaseUrl)];
}

function get(id, customBaseUrl) {
  const found = all(customBaseUrl).find((p) => p.id === id);
  if (!found) throw new Error(`Unknown AI provider: ${id}`);
  return found;
}

/** What the interface needs to render the provider list - never a key. */
function describe(customBaseUrl) {
  return all(customBaseUrl).map((p) => ({
    id: p.id,
    label: p.label,
    keyHint: p.keyHint,
    docsUrl: p.docsUrl,
    supportsImage: p.supportsImage,
    supportsVision: p.supportsVision,
    needsBaseUrl: !!p.needsBaseUrl,
    defaultImageModel: p.defaultImageModel ?? '',
    defaultVisionModel: p.defaultVisionModel ?? '',
  }));
}

/**
 * A model to read photographs and measurements with, from the models a key
 * actually has.
 *
 * Used when the saved one is refused - retired by the provider, or never on
 * this key. A read is a short job, so a fast "flash"-class model is preferred
 * over a large one, a stable model over a preview, and the newest version
 * over an older one. An alias that always points at the current release
 * ("-latest") is preferred most of all: it is the one that will not be
 * retired out from under the tailor again.
 */
function pickReadModel(list, avoid = '') {
  const score = (name) => {
    const n = name.toLowerCase();
    if (/tts|audio|live|embed|image|imagen|veo|robotics|computer-use/.test(n)) return -Infinity;
    let s = 0;
    if (/flash|haiku|mini|sonnet/.test(n)) s += 4;
    if (/lite|nano/.test(n)) s -= 1;
    if (/preview|exp|experimental/.test(n)) s -= 3;
    if (/latest/.test(n)) s += 2;
    const version = parseFloat((/(\d+(?:\.\d+)?)/.exec(n) ?? [])[1] ?? '0');
    return s * 100 + (Number.isFinite(version) ? version : 0);
  };
  const candidates = (list?.vision?.length ? list.vision : list?.all ?? [])
    .map((m) => m.name)
    .filter((name) => name && name !== avoid && score(name) > -Infinity);
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] ?? null;
}

/** Secret names, one per provider, kept in step with the allowlist in main. */
const SECRET_NAMES = ['gemini', 'openai', 'anthropic', 'custom'];

module.exports = { all, get, describe, pickReadModel, SECRET_NAMES, PROVIDER_IDS: SECRET_NAMES };
