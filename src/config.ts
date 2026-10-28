import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PORTAL_BASE_URL: z.string().url().default('https://urja-ops.flockenergy.tech'),
  PORTAL_USERNAME: z.string().min(1, 'PORTAL_USERNAME is required'),
  PORTAL_PASSWORD: z.string().min(1, 'PORTAL_PASSWORD is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type Config = z.infer<typeof envSchema>;
