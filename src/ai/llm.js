// On-device LLM via WebLLM (WebGPU). Model weights download once from Hugging Face and are
// cached by the browser; prompts — including the portfolio summary — never leave the device.

export const MODELS = [
  { base: 'Qwen2.5-1.5B-Instruct', name: 'Qwen 2.5 · 1.5B', note: 'Balanced · ~1 GB download', recommended: true },
  { base: 'Llama-3.2-1B-Instruct', name: 'Llama 3.2 · 1B', note: 'Lightest · ~0.7 GB download' },
  { base: 'Qwen2.5-3B-Instruct', name: 'Qwen 2.5 · 3B', note: 'Best answers · ~2 GB download' },
];

let enginePromise = null;
let loadedId = null;

export async function detectWebGPU() {
  if (!('gpu' in navigator)) return { ok: false, reason: "This browser doesn't support WebGPU. Try a recent Chrome or Edge on desktop." };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'WebGPU is available but no compatible GPU was found.' };
    return { ok: true, f16: adapter.features.has('shader-f16') };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export const modelId = (base, f16) => `${base}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;

export async function isCached(id) {
  try {
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    return await hasModelInCache(id);
  } catch {
    return false;
  }
}

export async function loadEngine(id, onProgress) {
  if (enginePromise && loadedId === id) return enginePromise;
  if (enginePromise) {
    const old = await enginePromise.catch(() => null);
    await old?.unload?.();
  }
  loadedId = id;
  enginePromise = (async () => {
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
    const worker = new Worker(new URL('./llm.worker.js', import.meta.url), { type: 'module' });
    return CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: onProgress });
  })();
  enginePromise.catch(() => {
    enginePromise = null;
    loadedId = null;
  });
  return enginePromise;
}

export async function* streamChat(engine, messages) {
  const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.2, max_tokens: 700 });
  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
