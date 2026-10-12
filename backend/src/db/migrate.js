import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from './pool.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const applied = new Set(
    (await query('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
  );
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });
    console.log(`Applied migration ${file}`);
  }
}
