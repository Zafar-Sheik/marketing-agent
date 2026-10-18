import { drizzle } from 'drizzle-orm/pglite';
import { createPglite, setDb, schema, type Db } from '@/db';

/** Fresh, empty Postgres (with the real schema) for one test file. */
export async function freshDb(): Promise<Db> {
  const pg = await createPglite();
  const database = drizzle(pg, { schema }) as unknown as Db;
  setDb(database);
  return database;
}
