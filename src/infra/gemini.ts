// Gemini image generation — raw fetch wrapper.
// Returns a discriminated result so callers distinguish "API/network failure" from
// "model refused" without try/catch noise. Never throws.

export const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';

function endpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export type GeminiImageResult =
  | { ok: true; bytes: Uint8Array; mimeType: string }
  | { ok: false; reason: string };

interface InlineData {
  data?: string;
  mimeType?: string;
}
interface Part {
  inlineData?: InlineData;
  text?: string;
}
interface Candidate {
  content?: { parts?: Part[] };
  finishReason?: string;
}
interface GenerateContentResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
}

export interface GenerateImageOptions {
  model?: string;
  fetchImpl?: typeof fetch;
}

export async function generateImage(
  prompt: string,
  apiKey: string,
  opts: GenerateImageOptions = {},
): Promise<GeminiImageResult> {
  const model = opts.model ?? DEFAULT_IMAGE_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(endpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        },
      }),
    });
  } catch (err) {
    return { ok: false, reason: `network_error: ${(err as Error).message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `http_${res.status}: ${body.slice(0, 200)}` };
  }

  let json: GenerateContentResponse;
  try {
    json = (await res.json()) as GenerateContentResponse;
  } catch (err) {
    return { ok: false, reason: `parse_error: ${(err as Error).message}` };
  }

  if (json.promptFeedback?.blockReason) {
    return { ok: false, reason: `prompt_blocked: ${json.promptFeedback.blockReason}` };
  }

  const candidate = json.candidates?.[0];
  if (!candidate) {
    return { ok: false, reason: 'no_candidates' };
  }

  const inlinePart = candidate.content?.parts?.find((p) => p.inlineData?.data);
  if (!inlinePart?.inlineData?.data) {
    return { ok: false, reason: `no_image: finishReason=${candidate.finishReason ?? 'unknown'}` };
  }

  const bytes = base64ToBytes(inlinePart.inlineData.data);
  const mimeType = inlinePart.inlineData.mimeType ?? 'image/png';
  return { ok: true, bytes, mimeType };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
