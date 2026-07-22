import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, suppliers } from '@fulfillment-tracker/db';
import { getParser, parserRegistry, REGEX_CONFIDENCE_THRESHOLD } from '@fulfillment-tracker/core';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const supplierSchema = z.object({
  name: z.string().min(1),
  apiBaseUrl: z.string().url(),
  apiKeyRef: z.string().min(1),
  emailSenderPattern: z.string().min(1),
  parserId: z.string().refine((id) => id in parserRegistry, { message: 'Unknown parserId' }),
  active: z.boolean().default(true),
});

const testParserSchema = z.object({
  subject: z.string().default(''),
  text: z.string().min(1),
});

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select().from(suppliers).where(eq(suppliers.userId, c.get('userId')));
  return c.json({ suppliers: rows });
});

app.post('/', async (c) => {
  const parsed = supplierSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const id = newId();
  await db.insert(suppliers).values({
    id,
    userId: c.get('userId'),
    name: parsed.data.name,
    apiBaseUrl: parsed.data.apiBaseUrl,
    apiKeyRef: parsed.data.apiKeyRef,
    emailSenderPattern: parsed.data.emailSenderPattern,
    parserId: parsed.data.parserId,
    active: parsed.data.active ? 1 : 0,
    createdAt: now(),
  });
  return c.json({ id }, 201);
});

app.patch('/:id', async (c) => {
  const parsed = supplierSchema.partial().safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const supplierId = c.req.param('id');
  const [existing] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!existing || existing.userId !== c.get('userId')) {
    return errorResponse(c, 'NOT_FOUND', 'Supplier not found', 404);
  }

  await db
    .update(suppliers)
    .set({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.apiBaseUrl !== undefined && { apiBaseUrl: parsed.data.apiBaseUrl }),
      ...(parsed.data.apiKeyRef !== undefined && { apiKeyRef: parsed.data.apiKeyRef }),
      ...(parsed.data.emailSenderPattern !== undefined && { emailSenderPattern: parsed.data.emailSenderPattern }),
      ...(parsed.data.parserId !== undefined && { parserId: parsed.data.parserId }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active ? 1 : 0 }),
    })
    .where(eq(suppliers.id, supplierId));

  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const supplierId = c.req.param('id');
  const [existing] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!existing || existing.userId !== c.get('userId')) {
    return errorResponse(c, 'NOT_FOUND', 'Supplier not found', 404);
  }
  await db.delete(suppliers).where(eq(suppliers.id, supplierId));
  return c.json({ ok: true });
});

app.post('/:id/test-parser', async (c) => {
  const parsed = testParserSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const supplierId = c.req.param('id');
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier || supplier.userId !== c.get('userId')) {
    return errorResponse(c, 'NOT_FOUND', 'Supplier not found', 404);
  }

  const parser = getParser(supplier.parserId);
  if (!parser) {
    return errorResponse(c, 'NOT_FOUND', `No parser registered for '${supplier.parserId}'`, 404);
  }

  const result = parser({ subject: parsed.data.subject, text: parsed.data.text });
  return c.json({ ...result, usedFallback: result.confidence < REGEX_CONFIDENCE_THRESHOLD });
});

export default app;
