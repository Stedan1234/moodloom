import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess, touchProject } from '../middleware/project.js';
import { parse, z, text, hexColor } from '../lib/validate.js';

// The brand kit: a structured brand-guidelines document built from a
// project's own references. Everything here is forms and layout; there is
// no AI in it. Board items are referenced by id (a logo, a font file, an
// image that shows the style) and resolved by the client.
// mergeParams: mounted at /projects/:projectId/brand
export const brandKitRouter = Router({ mergeParams: true });
brandKitRouter.use(requireAuth);

const itemRef = z.number().int().positive();

export const brandKitSchema = z.object({
  name: text(120).optional(),
  tagline: text(200).optional(),
  story: text(3000).optional(),
  audience: text(2000).optional(),
  values: z.array(z.object({ name: text(60), description: text(400).optional() })).max(8).optional(),
  voice: z
    .object({
      summary: text(1000).optional(),
      traits: z.array(z.object({ name: text(60), description: text(400).optional() })).max(6).optional(),
      weSay: z.array(text(200)).max(10).optional(),
      weDontSay: z.array(text(200)).max(10).optional(),
    })
    .optional(),
  logos: z.array(z.object({ itemId: itemRef, label: text(80).optional(), usage: text(400).optional(), background: hexColor.optional() })).max(12).optional(),
  logoRules: z.object({ clearSpace: text(400).optional(), minSize: text(200).optional(), donts: z.array(text(200)).max(10).optional() }).optional(),
  colors: z
    .array(
      z.object({
        hex: hexColor,
        name: text(60).optional(),
        role: z.enum(['primary', 'secondary', 'accent', 'neutral']).optional(),
        meaning: text(300).optional(),
        usage: text(300).optional(),
      })
    )
    .max(16)
    .optional(),
  typography: z
    .array(
      z.object({
        role: z.enum(['display', 'body', 'accent']).optional(),
        family: text(80),
        itemId: itemRef.nullable().optional(),
        weights: text(120).optional(),
        usage: text(400).optional(),
        sample: text(200).optional(),
      })
    )
    .max(6)
    .optional(),
  imagery: z.object({ description: text(1500).optional(), itemIds: z.array(itemRef).max(12).optional(), avoid: text(800).optional() }).optional(),
  patterns: z.object({ description: text(1000).optional(), itemIds: z.array(itemRef).max(12).optional() }).optional(),
  rules: z.array(z.object({ kind: z.enum(['do', 'dont']), text: text(300), itemId: itemRef.nullable().optional() })).max(20).optional(),
});

brandKitRouter.get('/', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query('SELECT data, updated_at FROM brand_kits WHERE project_id = $1', [req.project.id]);
  res.json(result.rows[0] || { data: {}, updated_at: null });
});

brandKitRouter.put('/', projectAccess('editor'), async (req, res) => {
  const data = parse(brandKitSchema, req.body?.data);
  const result = await pool.query(
    `INSERT INTO brand_kits (project_id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (project_id) DO UPDATE SET data = $2, updated_at = now()
     RETURNING data, updated_at`,
    [req.project.id, JSON.stringify(data)]
  );
  await touchProject(req.project.id);
  res.json(result.rows[0]);
});
