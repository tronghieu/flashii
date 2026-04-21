// MCP adapter — registers tools, calls core/, returns structured + text content.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMcpAuthContext } from 'agents/mcp';
import { z } from 'zod';
import { buildCardUpdate, buildNewCard, rowToCard, tagFilterArg } from '../core/cards.js';
import { applyRating } from '../core/reviews.js';
import type { Card, RatingValue } from '../core/types.js';
import type { Client, InArgs } from '@libsql/client/web';
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
    'list_cards',
    {
      description: [
        'Browse the user\'s deck. Returns cards in pages, optionally filtered by tags or a free-text search.',
        '',
        'Use this when the user asks "what cards do I have", "find my cards about X", or wants to inspect/edit a specific card. For active study sessions use `get_due` instead — it filters to cards actually due now.',
        '',
        'Filters (all optional, AND-combined):',
        '- `tags`: any-match against card tags.',
        '- `search`: case-insensitive substring match on front or back.',
        '',
        'Pagination: `limit` + `offset`. Response includes `has_more`; increment offset by `limit` to fetch the next page.',
      ].join('\n'),
      inputSchema: {
        tags: z.array(z.string().min(1).max(64)).max(16).optional(),
        search: z.string().min(1).max(200).optional(),
        order: z.enum(['newest', 'oldest', 'due_soon']).default('newest'),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
      outputSchema: {
        cards: z.array(z.object(fullCardShape)),
        has_more: z.boolean(),
        next_offset: z.number().int().nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { userId, db } = readCtx();
      const tagsJson = tagFilterArg(args.tags);
      const searchTerm = args.search?.trim();
      const searchLike = searchTerm ? `%${searchTerm}%` : null;
      const orderClause =
        args.order === 'oldest'
          ? 'created_at ASC'
          : args.order === 'due_soon'
            ? 'due_at ASC'
            : 'created_at DESC';
      // Fetch limit+1 to detect has_more without a second COUNT query.
      const fetchLimit = args.limit + 1;
      const { rows } = await withReadRetry(() =>
        db.execute({
          sql: `
            SELECT * FROM cards c
            WHERE c.user_id = ?1
              AND (?2 = '[]' OR EXISTS (
                SELECT 1 FROM json_each(c.tags) ct
                JOIN json_each(?2) qt ON qt.value = ct.value
              ))
              AND (?3 IS NULL OR c.front LIKE ?3 COLLATE NOCASE OR c.back LIKE ?3 COLLATE NOCASE)
            ORDER BY ${orderClause}
            LIMIT ?4 OFFSET ?5
          `,
          args: [userId, tagsJson, searchLike, fetchLimit, args.offset],
        }),
      );
      const hasMore = rows.length > args.limit;
      const trimmed = hasMore ? rows.slice(0, args.limit) : rows;
      const cards = trimmed.map((r) => {
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
      const nextOffset = hasMore ? args.offset + args.limit : null;
      const filterDesc = [
        args.tags?.length ? `tags=[${args.tags.join(',')}]` : null,
        searchTerm ? `search="${searchTerm}"` : null,
      ]
        .filter(Boolean)
        .join(', ');
      const header =
        cards.length === 0
          ? `No cards found${filterDesc ? ` (${filterDesc})` : ''}.`
          : `${cards.length} card(s)${filterDesc ? ` matching ${filterDesc}` : ''}` +
            (hasMore ? ` (more available — next offset ${nextOffset}):` : ':');
      const text =
        cards.length === 0
          ? header
          : header +
            '\n\n' +
            cards
              .map((c, i) => {
                const lines = [
                  `${args.offset + i + 1}. **${c.front}**  _(id: \`${c.id}\`)_`,
                  `   - Back: ${c.back}`,
                ];
                if (c.ipa) lines.push(`   - IPA: /${c.ipa}/`);
                if (c.tags.length) lines.push(`   - Tags: ${c.tags.join(', ')}`);
                lines.push(`   - Due: ${c.due_at} · reps: ${c.reps} · lapses: ${c.lapses}`);
                return lines.join('\n');
              })
              .join('\n\n');
      return {
        content: [{ type: 'text', text }],
        structuredContent: { cards, has_more: hasMore, next_offset: nextOffset },
      };
    },
  );

  const editableRefineMsg =
    'at least one of front/back/ipa/examples/tags is required';

  server.registerTool(
    'edit_card',
    {
      description: [
        'Edit one or more user-visible fields of a card: `front`, `back`, `ipa`, `examples`, `tags`.',
        '',
        'Provide `card_id` plus at least one editable field. Fields you omit are left untouched.',
        '',
        'Semantics:',
        '- `tags` **overwrites** the existing tag list (not merge). Read the current tags with `list_cards` first if you want to add to them.',
        '- `examples` overwrites too.',
        '- `ipa` accepts `null` to clear it.',
        '- `status`, image, FSRS state, and scheduling are **not** editable here. Use `suspend_card` / `unsuspend_card` / `submit_rating` / `delete_card` for those.',
      ].join('\n'),
      inputSchema: {
        card_id: z.string().min(1),
        front: z.string().min(1).max(200).optional(),
        back: z.string().min(1).max(2000).optional(),
        ipa: z.string().max(200).nullable().optional(),
        examples: z.array(z.string().min(1).max(500)).min(2).max(3).optional(),
        tags: z.array(z.string().min(1).max(64)).max(16).optional(),
      },
      outputSchema: fullCardShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (
        args.front === undefined &&
        args.back === undefined &&
        args.ipa === undefined &&
        args.examples === undefined &&
        args.tags === undefined
      ) {
        return {
          isError: true,
          content: [{ type: 'text', text: editableRefineMsg }],
        };
      }
      const { userId, db } = readCtx();
      const { setClauses, bindArgs } = buildCardUpdate({
        front: args.front,
        back: args.back,
        ipa: args.ipa,
        examples: args.examples,
        tags: args.tags,
      });
      const updateRes = await db.execute({
        sql: `UPDATE cards SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
        args: [...bindArgs, args.card_id, userId] as InArgs,
      });
      if (updateRes.rowsAffected === 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Card not found: ${args.card_id}` }],
        };
      }
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
      const card = rowToCard(row as Record<string, unknown>);
      const out = {
        id: card.id,
        front: card.front,
        back: card.back,
        ipa: card.ipa,
        examples: card.examples,
        tags: card.tags,
        image_url: card.image_url,
        due_at: card.due_at,
        state: card.state,
        reps: card.reps,
        lapses: card.lapses,
      };
      return {
        content: [{ type: 'text', text: `Edited card ${card.id}` }],
        structuredContent: out,
      };
    },
  );

  async function setCardStatus(cardId: string, status: 'suspended' | 'ready') {
    const { userId, db } = readCtx();
    const updateRes = await db.execute({
      sql: 'UPDATE cards SET status = ? WHERE id = ? AND user_id = ?',
      args: [status, cardId, userId],
    });
    if (updateRes.rowsAffected === 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
      };
    }
    const { rows } = await withReadRetry(() =>
      db.execute({
        sql: 'SELECT * FROM cards WHERE id = ? AND user_id = ? LIMIT 1',
        args: [cardId, userId],
      }),
    );
    const row = rows[0];
    if (!row) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Card not found: ${cardId}` }],
      };
    }
    const card = rowToCard(row as Record<string, unknown>);
    const out = {
      id: card.id,
      front: card.front,
      back: card.back,
      ipa: card.ipa,
      examples: card.examples,
      tags: card.tags,
      image_url: card.image_url,
      due_at: card.due_at,
      state: card.state,
      reps: card.reps,
      lapses: card.lapses,
    };
    const verb = status === 'suspended' ? 'Suspended' : 'Unsuspended';
    return {
      content: [{ type: 'text' as const, text: `${verb} card ${card.id}` }],
      structuredContent: out,
    };
  }

  server.registerTool(
    'suspend_card',
    {
      description: [
        'Pull a card out of review rotation without deleting it.',
        '',
        'A suspended card is skipped by `get_due` and cannot be rated (until unsuspended). Idempotent — suspending an already-suspended card is a no-op success.',
      ].join('\n'),
      inputSchema: {
        card_id: z.string().min(1),
      },
      outputSchema: fullCardShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => setCardStatus(args.card_id, 'suspended'),
  );

  server.registerTool(
    'unsuspend_card',
    {
      description: [
        'Return a suspended card to normal review rotation.',
        '',
        'Idempotent — unsuspending an already-ready card is a no-op success. The card\'s next `due_at` is preserved; it reappears in `get_due` the next time it becomes due.',
      ].join('\n'),
      inputSchema: {
        card_id: z.string().min(1),
      },
      outputSchema: fullCardShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => setCardStatus(args.card_id, 'ready'),
  );

  server.registerTool(
    'delete_card',
    {
      description: [
        'Permanently delete a card and **all its review history**. This cannot be undone.',
        '',
        '**Before calling this tool, confirm with the user.** State the card (front/back) you\'re about to delete and ask for explicit confirmation. Do not call on a vague request like "clean up my deck" — identify the specific card first.',
        '',
        'If the user might want the card back later, suggest `suspend_card` instead.',
      ].join('\n'),
      inputSchema: {
        card_id: z.string().min(1),
      },
      outputSchema: {
        id: z.string(),
        deleted: z.boolean(),
        reviews_deleted: z.number().int(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { userId, db } = readCtx();
      const { rows } = await withReadRetry(() =>
        db.execute({
          sql: 'SELECT id FROM cards WHERE id = ? AND user_id = ? LIMIT 1',
          args: [args.card_id, userId],
        }),
      );
      if (rows.length === 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Card not found: ${args.card_id}` }],
        };
      }
      const results = await db.batch(
        [
          {
            sql: 'DELETE FROM reviews WHERE card_id = ? AND user_id = ?',
            args: [args.card_id, userId],
          },
          {
            sql: 'DELETE FROM cards WHERE id = ? AND user_id = ?',
            args: [args.card_id, userId],
          },
        ],
        'write',
      );
      const reviewsDeleted = Number(results[0]?.rowsAffected ?? 0);
      const out = {
        id: args.card_id,
        deleted: true,
        reviews_deleted: reviewsDeleted,
      };
      return {
        content: [
          {
            type: 'text',
            text: `Deleted card ${args.card_id} (and ${reviewsDeleted} review(s))`,
          },
        ],
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    'regenerate_image',
    {
      description: [
        'Generate a new mnemonic image for an existing card and replace the current one. Use when:',
        '- The original `add_card` call failed image generation (card has `image_url=null`).',
        '- The user wants a different image style or subject framing.',
        '- The existing image is off-topic for the card.',
        '',
        'If the user already has an image on this card, confirm before overwriting — the previous image is gone after this call (R2 object is overwritten at the same key).',
        '',
        '`image_prompt` is optional. If omitted, a prompt is derived from the card\'s front + back. Provide one for more control (see the Nano Banana Pro guidance in `add_card`).',
        '',
        'Failure handling: unlike `add_card` (fail-open), this tool returns an error if image generation fails — the card\'s existing `image_url` is left untouched.',
      ].join('\n'),
      inputSchema: {
        card_id: z.string().min(1),
        image_prompt: z.string().min(1).max(2000).optional(),
      },
      outputSchema: fullCardShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { userId, db, env, baseUrl } = readCtx();
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
      const existing = rowToCard(row as Record<string, unknown>);
      const prompt =
        args.image_prompt?.trim() || `${existing.front}: ${existing.back}`;
      const result = await generateImage(prompt, env.GEMINI_API_KEY, {
        model: env.GEMINI_IMAGE_MODEL,
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Image generation failed: ${result.reason}. Existing image_url is unchanged.`,
            },
          ],
        };
      }
      let newUrl: string;
      try {
        newUrl = await storeImage(
          env,
          baseUrl,
          userId,
          existing.id,
          result.bytes,
          result.mimeType,
        );
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `R2 upload failed: ${(err as Error).message}. Existing image_url is unchanged.`,
            },
          ],
        };
      }
      await db.execute({
        sql: 'UPDATE cards SET image_url = ? WHERE id = ? AND user_id = ?',
        args: [newUrl, existing.id, userId],
      });
      const updated = { ...existing, image_url: newUrl };
      const out = {
        id: updated.id,
        front: updated.front,
        back: updated.back,
        ipa: updated.ipa,
        examples: updated.examples,
        tags: updated.tags,
        image_url: updated.image_url,
        due_at: updated.due_at,
        state: updated.state,
        reps: updated.reps,
        lapses: updated.lapses,
      };
      return {
        content: [
          {
            type: 'text',
            text: `Regenerated image for ${existing.id}: ${newUrl}`,
          },
        ],
        structuredContent: out,
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
      if (card.status !== 'ready') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Card is suspended: ${card.id}. Call \`unsuspend_card\` first.`,
            },
          ],
        };
      }
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
