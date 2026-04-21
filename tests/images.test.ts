import { describe, expect, it, vi } from 'vitest';
import { imageKey, imageUrl, storeImage } from '../src/infra/images.js';
import type { Env } from '../src/infra/env.js';

describe('imageKey', () => {
  it('joins userId/cardId with .png', () => {
    expect(imageKey('user_1', 'card_abc')).toBe('user_1/card_abc.png');
  });
});

describe('imageUrl', () => {
  it('builds absolute URL from baseUrl', () => {
    expect(imageUrl('https://api.flashii.app', 'u', 'c')).toBe(
      'https://api.flashii.app/img/u/c.png',
    );
  });

  it('does not double-slash a baseUrl with trailing path', () => {
    // baseUrl is expected to be an origin (no trailing slash) per index.ts.
    expect(imageUrl('https://x.example', 'u', 'c')).toBe('https://x.example/img/u/c.png');
  });
});

describe('storeImage', () => {
  it('puts to R2 with png content-type and immutable cache headers, returns absolute url', async () => {
    const put = vi.fn(async () => ({}));
    const env = { IMAGES: { put } } as unknown as Env;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const url = await storeImage(env, 'https://api.flashii.app', 'u', 'c', bytes);
    expect(url).toBe('https://api.flashii.app/img/u/c.png');
    expect(put).toHaveBeenCalledTimes(1);
    const [key, body, opts] = put.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      { httpMetadata: { contentType: string; cacheControl: string } },
    ];
    expect(key).toBe('u/c.png');
    expect(body).toBe(bytes);
    expect(opts.httpMetadata.contentType).toBe('image/png');
    expect(opts.httpMetadata.cacheControl).toContain('immutable');
  });
});
