import { describe, expect, it, vi } from 'vitest';
import { generateImage } from '../src/infra/gemini.js';

function mockJson(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('generateImage', () => {
  it('returns bytes on happy path', async () => {
    // 1x1 transparent PNG
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
    const fetchImpl = mockJson({
      candidates: [
        {
          content: {
            parts: [
              { text: 'here is your image' },
              { inlineData: { mimeType: 'image/png', data: pngB64 } },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    });
    const r = await generateImage('a red apple', 'fake-key', { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mimeType).toBe('image/png');
      expect(r.bytes.byteLength).toBeGreaterThan(0);
      // PNG magic bytes
      expect(r.bytes[0]).toBe(0x89);
      expect(r.bytes[1]).toBe(0x50);
      expect(r.bytes[2]).toBe(0x4e);
      expect(r.bytes[3]).toBe(0x47);
    }
  });

  it('returns blocked reason on safety block (no inlineData)', async () => {
    const fetchImpl = mockJson({
      candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
    });
    const r = await generateImage('forbidden', 'fake-key', { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('SAFETY');
  });

  it('returns blocked reason on prompt_blocked', async () => {
    const fetchImpl = mockJson({
      candidates: [],
      promptFeedback: { blockReason: 'HARASSMENT' },
    });
    const r = await generateImage('forbidden', 'fake-key', { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('HARASSMENT');
  });

  it('returns http error on non-200', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('quota exceeded', { status: 429 }),
    ) as unknown as typeof fetch;
    const r = await generateImage('x', 'fake-key', { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('http_429');
  });

  it('returns network_error when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const r = await generateImage('x', 'fake-key', { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('network_error');
  });

  it('returns no_candidates on empty response', async () => {
    const fetchImpl = mockJson({});
    const r = await generateImage('x', 'fake-key', { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_candidates');
  });

  it('uses the configured model in the endpoint URL', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    await generateImage('x', 'k', { fetchImpl, model: 'gemini-3.1-flash-image-preview' });
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls[0]?.[0]).toContain('gemini-3.1-flash-image-preview');
  });
});
