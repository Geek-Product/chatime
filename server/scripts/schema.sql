-- Initial schema, generated from src/db/schema.ts with `drizzle-kit generate`.
-- `drizzle-kit push` is broken in this repo (drizzle-kit is pinned to 0.18), so apply this instead:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/scripts/schema.sql
-- Objects live in the `chatime` schema so a role without CREATE on `public` still works; the server
-- sets search_path to `chatime,public` (server/src/db/index.ts). Create the schema first:
--   CREATE SCHEMA chatime;
-- Re-generate after schema changes (run in a dir with drizzle-kit >= 0.30 and drizzle-orm matching):
--   drizzle-kit generate --dialect postgresql --schema server/src/db/schema.ts --out <tmp>
CREATE TYPE "chatime"."join_request_status" AS ENUM('pending', 'accepted', 'declined');
CREATE TYPE "chatime"."member_role" AS ENUM('owner', 'admin', 'member');
CREATE TABLE "chatime"."attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" uuid NOT NULL,
	"message_id" uuid,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"storage_key" text NOT NULL,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."channel_members" (
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
CREATE TABLE "chatime"."channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"topic" varchar(250),
	"is_private" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."direct_conversation_reads" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_conversation_reads_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
CREATE TABLE "chatime"."direct_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."join_requests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" "chatime"."join_request_status" DEFAULT 'pending' NOT NULL,
	"message" varchar(500),
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."message_mentions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "message_mentions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
CREATE TABLE "chatime"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"direct_conversation_id" uuid,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"content" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
CREATE TABLE "chatime"."reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(16) NOT NULL,
	CONSTRAINT "reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
CREATE TABLE "chatime"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
CREATE TABLE "chatime"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(32) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_color" varchar(16) DEFAULT '#5865F2' NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"message_id" uuid,
	"status" varchar(16) NOT NULL,
	"error" text,
	"payload_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "chatime"."webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bot_user_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" text NOT NULL,
	"template" text,
	"notify" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_token_hash_unique" UNIQUE("token_hash")
);
CREATE TABLE "chatime"."workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "chatime"."member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
CREATE TABLE "chatime"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
ALTER TABLE "chatime"."attachments" ADD CONSTRAINT "attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chatime"."messages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "chatime"."channels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "chatime"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."channels" ADD CONSTRAINT "channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "chatime"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chatime"."direct_conversation_reads" ADD CONSTRAINT "direct_conversation_reads_conversation_id_direct_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chatime"."direct_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."direct_conversation_reads" ADD CONSTRAINT "direct_conversation_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."direct_conversations" ADD CONSTRAINT "direct_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "chatime"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."direct_conversations" ADD CONSTRAINT "direct_conversations_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."direct_conversations" ADD CONSTRAINT "direct_conversations_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."join_requests" ADD CONSTRAINT "join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."join_requests" ADD CONSTRAINT "join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "chatime"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "chatime"."message_mentions" ADD CONSTRAINT "message_mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chatime"."messages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."message_mentions" ADD CONSTRAINT "message_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."messages" ADD CONSTRAINT "messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "chatime"."channels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."messages" ADD CONSTRAINT "messages_direct_conversation_id_direct_conversations_id_fk" FOREIGN KEY ("direct_conversation_id") REFERENCES "chatime"."direct_conversations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chatime"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chatime"."messages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "chatime"."webhooks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."webhooks" ADD CONSTRAINT "webhooks_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "chatime"."channels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "chatime"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."webhooks" ADD CONSTRAINT "webhooks_bot_user_id_users_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "chatime"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chatime"."webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "chatime"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chatime"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "chatime"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "chatime"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chatime"."workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "chatime"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "attachments_message_idx" ON "chatime"."attachments" USING btree ("message_id");
CREATE INDEX "attachments_uploader_idx" ON "chatime"."attachments" USING btree ("uploader_id");
CREATE INDEX "channel_members_user_idx" ON "chatime"."channel_members" USING btree ("user_id");
CREATE UNIQUE INDEX "channels_workspace_name_unique" ON "chatime"."channels" USING btree ("workspace_id",lower("name"));
CREATE INDEX "direct_conversation_reads_user_idx" ON "chatime"."direct_conversation_reads" USING btree ("user_id");
CREATE UNIQUE INDEX "direct_conversations_pair_unique" ON "chatime"."direct_conversations" USING btree ("workspace_id","user_a","user_b");
CREATE INDEX "direct_conversations_user_b_idx" ON "chatime"."direct_conversations" USING btree ("user_b");
CREATE INDEX "join_requests_status_idx" ON "chatime"."join_requests" USING btree ("status","created_at");
CREATE INDEX "message_mentions_user_idx" ON "chatime"."message_mentions" USING btree ("user_id");
CREATE INDEX "messages_channel_created_idx" ON "chatime"."messages" USING btree ("channel_id","created_at");
CREATE INDEX "messages_dm_created_idx" ON "chatime"."messages" USING btree ("direct_conversation_id","created_at");
CREATE INDEX "messages_parent_idx" ON "chatime"."messages" USING btree ("parent_id") WHERE "chatime"."messages"."parent_id" is not null;
CREATE INDEX "push_subscriptions_user_idx" ON "chatime"."push_subscriptions" USING btree ("user_id");
CREATE INDEX "refresh_tokens_user_idx" ON "chatime"."refresh_tokens" USING btree ("user_id");
CREATE UNIQUE INDEX "users_email_unique" ON "chatime"."users" USING btree (lower("email"));
CREATE UNIQUE INDEX "users_username_unique" ON "chatime"."users" USING btree (lower("username"));
CREATE INDEX "webhook_deliveries_webhook_idx" ON "chatime"."webhook_deliveries" USING btree ("webhook_id","created_at");
CREATE INDEX "webhooks_channel_idx" ON "chatime"."webhooks" USING btree ("channel_id");
CREATE INDEX "webhooks_workspace_idx" ON "chatime"."webhooks" USING btree ("workspace_id");
CREATE INDEX "workspace_members_user_idx" ON "chatime"."workspace_members" USING btree ("user_id");
