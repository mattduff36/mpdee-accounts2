-- Append-only guard for approved charge snapshots. Development migration; not applied to production here.
CREATE FUNCTION "cost_charge_snapshot_immutable"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Approved charge snapshots are append-only';
END;
$$;

CREATE TRIGGER "CostChargeSnapshot_append_only"
BEFORE UPDATE OR DELETE ON "CostChargeSnapshot"
FOR EACH ROW
EXECUTE FUNCTION "cost_charge_snapshot_immutable"();
