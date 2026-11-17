import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '../.env') });

export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/team_chat',
  },
};
