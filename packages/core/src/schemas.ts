import { z } from 'zod';

export const sourceCreateSchema = z.object({
  adapterId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const sourceUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const searchInputSchema = z.object({
  q: z.string().min(1).max(200),
  sourceIds: z.array(z.string().min(1)).optional(),
});

export const libraryAddSchema = z.object({
  sourceId: z.string().min(1),
  mangaId: z.string().min(1),
});

export const progressSchema = z.object({
  pageIndex: z.number().int().min(0),
});

export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;
export type SourceUpdateInput = z.infer<typeof sourceUpdateSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type LibraryAddInput = z.infer<typeof libraryAddSchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
