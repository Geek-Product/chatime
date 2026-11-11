import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../../env';
import * as schema from './schema';

// search_path lets a non-owner role use its own schema (see server/scripts/schema.sql).
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  onnotice: () => {},
  connection: { search_path: 'chatime,public' },
});
export const db = drizzle(sql, { schema });
export type DB = typeof db;
