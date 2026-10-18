# Migrations

`db/schema.sql` creates the database from scratch. Later changes go here as
`NNNN-description.sql` (e.g. `0002-add-client-notes.sql`); `npm run db:migrate`
applies each one once, in order, and records it in `schema_migrations`.
Update `db/schema.sql`, `src/db/schema.ts` and `docs/03-erd.md` in the same commit;
the tests fail if they disagree.
