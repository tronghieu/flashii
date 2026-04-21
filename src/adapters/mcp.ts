// MCP adapter — registers tools, calls core/, returns structured + text content.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMcpAuthContext } from 'agents/mcp';
import { z } from 'zod';
import { buildNewCard, rowToCard, tagFilterArg } from '../core/cards.js';
import { applyRating } from '../core/reviews.js';
import type { Card, RatingValue } from '../core/types.js';
import type { Client } from '@libsql/client/web';
import { withReadRetry } from '../infra/db.js';
import { generateImage } from '../infra/gemini.js';
import { storeImage } from '../infra/images.js';
import type { Env } from '../infra/env.js';

interface ToolCtx {
  userId: string;
  db: Client;
  env: Env;
  baseUrl: string;
}

function readCtx(): ToolCtx {
  const auth = getMcpAuthContext();
  const props = (auth?.props ?? {}) as Partial<ToolCtx>;
  if (!props.userId || !props.db || !props.env || !props.baseUrl) {
    throw new Error('Missing auth context: userId/db/env/baseUrl not propagated');
  }
  return { userId: props.userId, db: props.db, env: props.env, baseUrl: props.baseUrl };
}

const cardShape = {
  id: z.string(),
  due_at: z.string(),
  image_url: z.string().nullable().optional(),
};

const fullCardShape = {
  id: z.string(),
  front: z.string(),
  back: z.string(),
  ipa: z.string().nullable(),
  examples: z.array(z.string()),
  tags: z.array(z.string()),
  image_url: z.string().nullable(),
  due_at: z.string(),
  state: z.number(),
  reps: z.number(),
  lapses: z.number(),
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'flashii',
    version: '0.1.0',
  });

  server.registerTool(
    'add_card',
    {
      description: [
        'Add a finished flashcard. Provide front/back/examples/tags.',
        '',
        'Image generation (optional): set `needs_image=true` and provide `image_prompt` to generate a mnemonic image with Gemini Nano Banana Pro.',
        '',
        'When to request an image:',
        '- Use for **concrete, visualizable nouns or scenes**: "sourdough loaf", "rusty padlock", "phở bowl with steam".',
        '- Skip for abstract concepts, function words, grammar patterns, or anything that would be a generic stock photo.',
        '- Skip if the user is reviewing fast and you sense image cost is wasteful.',
        '',
        'How to write `image_prompt` for Nano Banana Pro:',
        '- Write a **scene description**, not just the word. Include subject + setting + lighting + style.',
        '- Use concrete visual nouns. Avoid abstract language.',
        '- 1-3 sentences works well; the model handles detail.',
        '- Example (good): `A crusty sourdough loaf cut in half on a wooden board, warm window light, rustic kitchen, food-photography style.`',
        '- Example (bad): `bread`',
        '',
        'Failure handling: if image generation fails or is blocked by safety, the card is still created with `image_url=null`. You can retry later with `regenerate_image` (not yet available).',
      ].join('\n'),
      inputSchema: {
        front: z.string().min(1).max(200),
        back: z.string().min(1).max(2000),
        ipa: z.string().max(200).optional(),
        examples: z.array(z.string().min(1).max(500)).min(2).max(3),
        tags: z.array(z.string().min(1).max(64)).max(16).default([]),
        needs_image: z.boolean().default(false),
        image_prompt: z.string().min(1).max(2000).optional(),
      },
      outputSchema: cardShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.needs_image && !args.image_prompt?.trim()) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'image_prompt is required when needs_image=true.' },
          ],
        };
      }

      const { userId, db, env, baseUrl } = readCtx();
      const row = buildNewCard(
        {
          front: args.front,
          back: args.back,
          ipa: args.ipa,
          examples: args.examples,
          tags: args.tags,
        },
        userId,
      );

      let imageUrl: string | null = null;
      let imageNote = '';
      if (args.needs_image && args.image_prompt) {
        const result = await generateImage(args.image_prompt, env.GEMINI_API_KEY, {
          model: env.GEMINI_IMAGE_MODEL,
        });
        if (result.ok) {
          try {
            imageUrl = await storeImage(env, baseUrl, userId, row.id, result.bytes, result.mimeType);
          } catch (err) {
            console.warn(`add_card: R2 store failed for ${row.id}:`, err);
            imageNote = ' (image upload failed; retry later)';
          }
        } else {
          console.warn(`add_card: image generation failed for ${row.id}: ${result.reason}`);
          imageNote = ` (image not generated: ${result.reason})`;
        }
      }

      await db.execute({
        sql: `INSERT INTO cards
                (id, user_id, front, back, ipa, examples, tags, image_url, status,
                 state, stability, difficulty, due_at, last_reviewed_at,
                 elapsed_days, scheduled_days, reps, lapses, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id, row.user_id, row.front, row.back, row.ipa,
          row.examples, row.tags, imageUrl, row.status,
          row.state, row.stability, row.difficulty, row.due_at, row.last_reviewed_at,
          row.elapsed_days, row.scheduled_days, row.reps, row.lapses, row.created_at,
        ],
      });

      const out = { id: row.id, due_at: row.due_at, image_url: imageUrl };
      const text = imageUrl
        ? `Added card ${row.id} with image ${imageUrl}, due ${row.due_at}`
        : `Added card ${row.id}, due ${row.due_at}${imageNote}`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    'get_due',
    {
      description:
        'Return cards due now, optionally filtered by tags (any-match). Default limit 20.',
      inputSchema: {
        tags: z.array(z.string().min(1).max(64)).max(16).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      outputSchema: { cards: z.array(z.object(fullCardShape)) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { userId, db } = readCtx();
      const nowIso = new Date().toISOString();
      const tagsJson = tagFilterArg(args.tags);
      const { rows } = await withReadRetry(() =>
        db.execute({
          sql: `
            SELECT * FROM cards c
            WHERE c.user_id = ?1
              AND c.status = 'ready'
              AND c.due_at <= ?2
              AND (?3 = '[]' OR EXISTS (
                SELECT 1 FROM json_each(c.tags) ct
                JOIN json_each(?3) qt ON qt.value = ct.value
              ))
            ORDER BY c.due_at
            LIMIT ?4
          `,
          args: [userId, nowIso, tagsJson, args.limit],
        }),
      );
      const cards = rows.map((r) => {
        const c = rowToCard(r as Record<string, unknown>);
        return {
          id: c.id,
          front: c.front,
          back: c.back,
          ipa: c.ipa,
          examples: c.examples,
          tags: c.tags,
          image_url: c.image_url,
          due_at: c.due_at,
          state: c.state,
          reps: c.reps,
          lapses: c.lapses,
        };
      });
      const text =
        cards.length === 0
          ? 'No cards due right now.'
          : `${cards.length} card(s) due:\n\n` +
            cards
              .map((c, i) => {
                const lines = [
                  `${i + 1}. **${c.front}**  _(id: \`${c.id}\`)_`,
                  `   - Back: ${c.back}`,
                ];
                if (c.ipa) lines.push(`   - IPA: /${c.ipa}/`);
                if (c.image_url) lines.push(`   - ![mnemonic](${c.image_url})`);
                if (c.examples.length) {
                  lines.push('   - Examples:');
                  for (const ex of c.examples) lines.push(`     - ${ex}`);
                }
                if (c.tags.length) lines.push(`   - Tags: ${c.tags.join(', ')}`);
                return lines.join('\n');
              })
              .join('\n\n');
      return {
        content: [{ type: 'text', text }],
        structuredContent: { cards },
      };
    },
  );

  server.registerTool(
    'submit_rating',
    {
      description:
        'Submit a review rating for a card (1=Again, 2=Hard, 3=Good, 4=Easy). Updates FSRS state and appends to the review log atomically.',
      inputSchema: {
        card_id: z.string().min(1),
        rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      },
      outputSchema: {
        due_at: z.string(),
        stability: z.number(),
        difficulty: z.number(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { userId, db } = readCtx();
      const { rows } = await withReadRetry(() =>
        db.execute({
          sql: 'SELECT * FROM cards WHERE id = ? AND user_id = ? LIMIT 1',
          args: [args.card_id, userId],
        }),
      );
      const row = rows[0];
      if (!row) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Card not found: ${args.card_id}` }],
        };
      }
      const card: Card = rowToCard(row as Record<string, unknown>);
      const delta = applyRating(card, args.rating as RatingValue);

      await db.batch(
        [
            {
              sql: `INSERT INTO reviews
                      (id, user_id, card_id, rating, reviewed_at,
                       elapsed_days, stability_after, difficulty_after, due_after)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                delta.reviewRow.id, delta.reviewRow.user_id, delta.reviewRow.card_id,
                delta.reviewRow.rating, delta.reviewRow.reviewed_at,
                delta.reviewRow.elapsed_days, delta.reviewRow.stability_after,
                delta.reviewRow.difficulty_after, delta.reviewRow.due_after,
              ],
            },
            {
              sql: `UPDATE cards
                    SET state = ?, stability = ?, difficulty = ?, due_at = ?,
                        last_reviewed_at = ?, elapsed_days = ?, scheduled_days = ?,
                        reps = ?, lapses = ?
                    WHERE id = ? AND user_id = ?`,
              args: [
                delta.cardUpdate.state, delta.cardUpdate.stability,
                delta.cardUpdate.difficulty, delta.cardUpdate.due_at,
                delta.cardUpdate.last_reviewed_at, delta.cardUpdate.elapsed_days,
                delta.cardUpdate.scheduled_days, delta.cardUpdate.reps,
                delta.cardUpdate.lapses,
                card.id, userId,
              ],
            },
        ],
        'write',
      );

      const out = {
        due_at: delta.cardUpdate.due_at,
        stability: delta.cardUpdate.stability,
        difficulty: delta.cardUpdate.difficulty,
      };
      return {
        content: [
          { type: 'text', text: `Next due ${out.due_at}` },
        ],
        structuredContent: out,
      };
    },
  );

  return server;
}
