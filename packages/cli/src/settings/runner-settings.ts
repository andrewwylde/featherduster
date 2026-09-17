import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseDocument, isMap } from 'yaml';

const RUNNER_IDS = ['claude-code', 'anthropic-api', 'ollama'] as const;

export const RunnerSettingsPatchSchema = z
  .object({
    default: z.enum(RUNNER_IDS).optional(),
    step_timeout_seconds: z.number().int().min(30).max(3600).optional(),
    deslop_warn_band: z.enum(['low', 'moderate', 'high']).optional(),
    'claude-code': z.object({ model: z.string().max(100) }).partial().strict().optional(),
    'anthropic-api': z.object({ model: z.string().min(1).max(100) }).partial().strict().optional(),
    ollama: z
      .object({
        url: z
          .string()
          .url()
          .refine((u) => /^https?:\/\//.test(u), 'URL must be http(s)'),
        model: z.string().max(200),
        max_context: z.number().int().min(2048).max(1_048_576),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
export type RunnerSettingsPatch = z.infer<typeof RunnerSettingsPatchSchema>;

function configPath(workspaceDir: string): string {
  return path.join(workspaceDir, '.featherduster', 'config.yaml');
}

function loadDocument(workspaceDir: string) {
  const file = configPath(workspaceDir);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(`.featherduster/config.yaml is not valid YAML: ${doc.errors[0].message}`);
  }
  if (!isMap(doc.contents)) {
    doc.contents = doc.createNode({}) as any;
  }
  return doc;
}

function saveDocument(workspaceDir: string, doc: ReturnType<typeof parseDocument>): void {
  const file = configPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('Refusing to write a symlinked config.yaml');
  }
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf-8');
}

/** Applies a validated patch to config.yaml, preserving comments, order, and unrelated keys. */
export function writeRunnerSettings(workspaceDir: string, patch: RunnerSettingsPatch): void {
  const doc = loadDocument(workspaceDir);
  const { deslop_warn_band, ...runner } = patch;
  for (const [key, value] of Object.entries(runner)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object') {
      for (const [sub, subValue] of Object.entries(value)) {
        if (subValue !== undefined) doc.setIn(['runner', key, sub], subValue);
      }
    } else {
      doc.setIn(['runner', key], value);
    }
  }
  if (deslop_warn_band) doc.setIn(['deslop_warn_band'], deslop_warn_band);
  saveDocument(workspaceDir, doc);
}

export function revokeRunnerConsent(workspaceDir: string, runnerId: string): void {
  const doc = loadDocument(workspaceDir);
  if (doc.hasIn(['runner_consent', runnerId])) {
    doc.deleteIn(['runner_consent', runnerId]);
    saveDocument(workspaceDir, doc);
  }
}
