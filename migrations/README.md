# Migrations (migrate-mongo)

Schema/data migrations for the NitiGrow backend MongoDB.

## Scripts

Run from `backend/`:

- `npm run migrate:status` — list each migration and whether it's `PENDING` or has a timestamp (applied).
- `npm run migrate:up` — apply all `PENDING` migrations in order.
- `npm run migrate:down` — roll back the most recently applied migration.
- `npm run migrate:create <name>` — scaffold a new migration file in `migrations/`.

## File naming

`<unix-ts>-<short-kebab-description>.js`

migrate-mongo orders migrations lexicographically, so the timestamp prefix matters.
Use `npm run migrate:create` to get the prefix right automatically.

## Authoring rules

- **Write reversible migrations whenever possible.** Pair every `up` with a matching `down`.
- If a migration is truly irreversible (e.g. dropped a field whose data is gone), the `down` should `throw new Error('irreversible — restore from backup')` — never a silent no-op.
- Idempotency is nice-to-have: prefer `updateMany({ field: { $exists: false } }, ...)` over blind writes.
- Keep migrations small and focused; one logical change per file.
- Do not import Mongoose models. Use the raw `db` driver passed in so migrations stay decoupled from the current schema.

## Where it runs

The config resolves `MONGODB_URI` from the current process's environment (`.env` via `dotenv`). **Whatever URI is in scope when you run `npm run migrate:up` is the database that gets mutated.** Double-check before running anywhere near prod — ideally run prod migrations from a deploy job with an explicitly-set env var, not your laptop shell.

## Changelog collection

Applied migrations are recorded in the `migrations_changelog` collection on the target database.
