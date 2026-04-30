import { z } from 'zod';

const animeStatusSchema = z.enum(['watching', 'completed', 'dropped', 'plan_to_watch']);

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').optional().nullable();

const stringArraySchema = z.array(z.string().max(200)).max(100).optional();

export const createAnimeSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(500),
  originalTitle: z.string().max(500).optional().nullable(),
  coverUrl: z.string().url().max(2000).optional().nullable().or(z.literal('')),
  status: animeStatusSchema.default('plan_to_watch'),
  score: z.number().min(0).max(10).optional().nullable(),
  progress: z.number().int().min(0).default(0),
  totalEpisodes: z.number().int().min(0).max(9999).optional().nullable(),
  durationMinutes: z.number().int().min(0).max(9999).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  tags: stringArraySchema,
  cast: stringArraySchema,
  castAliases: stringArraySchema,
  summary: z.string().max(10000).optional().nullable(),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  premiereDate: dateStringSchema,
  isFinished: z.boolean().optional().nullable(),
});

export const updateAnimeSchema = createAnimeSchema.partial();

export const patchAnimeBodySchema = updateAnimeSchema.extend({
  recordHistory: z.boolean().optional(),
});

export type CreateAnimeInput = z.infer<typeof createAnimeSchema>;
export type UpdateAnimeInput = z.infer<typeof updateAnimeSchema>;
