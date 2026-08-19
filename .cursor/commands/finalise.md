# /finalise

This command authorizes local finalisation and commit for **mpdee-accounts2**. It does not authorize a push.

This is not avsworklog. Do not run avsworklog scripts, `finalise:repair`, or `workflow-protocol.ts`.

1. State the current branch and a short summary of what will be committed.
2. Confirm `git remote get-url origin` exists if a later push is expected; do not push now.
3. Run `npm run finalise`.
4. Do not run `prisma migrate deploy`, `prisma migrate dev`, or `db push`.
5. If finalise refuses mixed hygiene/app changes, stop unless the user explicitly asked for `--allow-mixed`.
6. If it refuses a remote database host, stop unless the user explicitly asked for `--allow-remote-db`.
7. Never generically repair commit, push, or migration failures.
