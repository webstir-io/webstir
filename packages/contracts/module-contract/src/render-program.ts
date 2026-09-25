import { z } from 'zod';

export const RENDER_PROGRAM_VERSION = 1;
export const RENDER_PROGRAM_FILE = 'index.program.json';

export const renderSourceLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
});

export type RenderSourceLocation = z.infer<typeof renderSourceLocationSchema>;

export const renderPathSchema = z.object({
  source: z.string().min(1),
  scope: z.number().int().min(-1),
  keys: z.array(z.string().min(1)),
});

export type RenderPath = z.infer<typeof renderPathSchema>;

export type RenderNode =
  | string
  | { readonly op: 'text'; readonly path: RenderPath; readonly loc: RenderSourceLocation }
  | {
      readonly op: 'attr';
      readonly name: string;
      readonly url: boolean;
      readonly path: RenderPath;
      readonly loc: RenderSourceLocation;
    }
  | {
      readonly op: 'if';
      readonly negate: boolean;
      readonly path: RenderPath;
      readonly loc: RenderSourceLocation;
      readonly body: readonly RenderNode[];
    }
  | {
      readonly op: 'each';
      readonly as: string;
      readonly path: RenderPath;
      readonly loc: RenderSourceLocation;
      readonly body: readonly RenderNode[];
    }
  | { readonly op: 'csrf' };

export const renderNodeSchema: z.ZodType<RenderNode> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({ op: z.literal('text'), path: renderPathSchema, loc: renderSourceLocationSchema }),
    z.object({
      op: z.literal('attr'),
      name: z.string().min(1),
      url: z.boolean(),
      path: renderPathSchema,
      loc: renderSourceLocationSchema,
    }),
    z.object({
      op: z.literal('if'),
      negate: z.boolean(),
      path: renderPathSchema,
      loc: renderSourceLocationSchema,
      body: z.array(renderNodeSchema),
    }),
    z.object({
      op: z.literal('each'),
      as: z.string().min(1),
      path: renderPathSchema,
      loc: renderSourceLocationSchema,
      body: z.array(renderNodeSchema),
    }),
    z.object({ op: z.literal('csrf') }),
  ]),
);

export const renderProgramSchema = z.object({
  version: z.literal(RENDER_PROGRAM_VERSION),
  page: z.string().min(1),
  source: z.string().min(1),
  bindings: z.number().int().min(0),
  nodes: z.array(renderNodeSchema),
});

export type RenderProgram = z.infer<typeof renderProgramSchema>;

export const renderFlashMessageSchema = z.object({
  level: z.enum(['info', 'success', 'warning', 'error']),
  message: z.string(),
});

export type RenderFlashMessage = z.infer<typeof renderFlashMessageSchema>;

export const renderFlashSchema = z.array(renderFlashMessageSchema);
