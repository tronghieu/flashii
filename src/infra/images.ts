// R2 image storage. Worker-served — keys are unguessable ULIDs, no signed URLs in MVP.
import type { Env } from './env.js';

export function imageKey(userId: string, cardId: string): string {
  return `${userId}/${cardId}.png`;
}

export function imageUrl(baseUrl: string, userId: string, cardId: string): string {
  return `${baseUrl}/img/${userId}/${cardId}.png`;
}

export async function storeImage(
  env: Env,
  baseUrl: string,
  userId: string,
  cardId: string,
  bytes: Uint8Array,
  mimeType: string = 'image/png',
): Promise<string> {
  await env.IMAGES.put(imageKey(userId, cardId), bytes, {
    httpMetadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  return imageUrl(baseUrl, userId, cardId);
}
