CREATE TABLE "CostProviderObservation" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accountRef" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostProviderObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostProviderObservation_provider" CHECK ("provider" = 'vercel'),
  CONSTRAINT "CostProviderObservation_checksum" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CostProviderObservation_version" CHECK (
    jsonb_typeof("payload") = 'object'
    AND "payload" ? 'version'
    AND "payload"->>'version' = 'mpdee-provider-observation-v1'
  )
);
CREATE UNIQUE INDEX "CostProviderObservation_identity_checksum_key"
  ON "CostProviderObservation"("provider", "accountRef", "sourceKey", "checksum");
CREATE INDEX "CostProviderObservation_latest_idx"
  ON "CostProviderObservation"("provider", "accountRef", "sourceKey", "observedAt", "createdAt");
