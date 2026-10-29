import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PORTAL_BASE_URL: z.string().url().default('https://urja-ops.flockenergy.tech'),
  PORTAL_USERNAME: z.string().min(1, 'PORTAL_USERNAME is required').default('test-operator@urja.local'),
  PORTAL_PASSWORD: z.string().min(1, 'PORTAL_PASSWORD is required').default('test-portal-password'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(result.error.format())}`);
  }

  const cfg = result.data;

  // Enforce HTTPS in production environments
  if (cfg.NODE_ENV === 'production' && !cfg.PORTAL_BASE_URL.startsWith('https://')) {
    throw new Error('Insecure configuration: PORTAL_BASE_URL must use HTTPS in production');
  }

  return cfg;
}

// Lazy/default config instance
export const config = loadConfig(process.env);
