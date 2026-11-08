import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: path.resolve(import.meta.dirname, '../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  APP_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5433/team_chat'),
  JWT_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  UPLOAD_DIR: z.string().default('server/uploads'),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).default(25),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
});

export const env = schema.parse(process.env);
