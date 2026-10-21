import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { config } from './config.js';

// Keep `date` columns as 'YYYY-MM-DD' strings: converting them to a JS Date shifts the day by timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// bigserial ids fit comfortably in a JS number for this app.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

/** Applies schema.sql. Retries while Postgres is still starting. */
export async function migrate(): Promise<void> {
  const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      return;
    } catch (err) {
      if (attempt >= 15) throw err;
      console.warn(`Database not ready (attempt ${attempt}), retrying in 2s`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
