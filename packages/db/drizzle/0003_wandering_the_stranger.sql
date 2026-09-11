CREATE TABLE IF NOT EXISTS "beneficiary_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"address" text NOT NULL,
	"reason" text NOT NULL,
	"device_id" text,
	"human_proof_ref" text NOT NULL,
	"nullifier" numeric(78, 0) NOT NULL,
	"world_proof" jsonb,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "privy_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "beneficiary_verifications" ADD CONSTRAINT "beneficiary_verifications_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "beneficiary_verifications_addr_nullifier_idx" ON "beneficiary_verifications" USING btree ("beneficiary_id","address","nullifier");
