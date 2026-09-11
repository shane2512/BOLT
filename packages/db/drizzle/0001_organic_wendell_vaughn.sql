ALTER TABLE "unlock_approvals" ADD COLUMN "nullifier" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "unlock_approvals" ADD COLUMN "world_proof" jsonb;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD COLUMN "intent_id" text;--> statement-breakpoint
ALTER TABLE "unlock_requests" ADD COLUMN "key_quorum_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unlock_approvals_request_nullifier_idx" ON "unlock_approvals" USING btree ("unlock_request_id","nullifier");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unlock_approvals_request_approver_idx" ON "unlock_approvals" USING btree ("unlock_request_id","approver");