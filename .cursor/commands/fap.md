# /fap

This command explicitly authorizes local finalisation, commit, and pushing the current branch for **mpdee-accounts2**.

This is not avsworklog and not a Vercel/Higgsfield deploy skill. Do not run avsworklog scripts.

1. State the current branch, `origin` URL, and a short summary of what will be pushed.
2. Confirm origin is the intended remote before pushing.
3. Run `npm run finalise:push`.
4. Do not run `prisma migrate deploy`, `prisma migrate dev`, or `db push`.
5. If finalise refuses mixed hygiene/app changes, stop unless the user explicitly asked for `--allow-mixed`.
6. If it refuses a remote database host, stop unless the user explicitly asked for `--allow-remote-db`.
7. Never generically repair commit, push, or migration failures.
8. Vercel MCP is optional. Git push is the deploy path; production migrations run only on `VERCEL_ENV=production` via `npm run build:vercel`.
