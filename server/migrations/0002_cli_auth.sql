CREATE TABLE "cli_auth_request" (
	"device_code" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text,
	"session_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_auth_request_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "cli_session" (
	"session_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cli_auth_request" ADD CONSTRAINT "cli_auth_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_session" ADD CONSTRAINT "cli_session_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_auth_request_user_code_idx" ON "cli_auth_request" USING btree ("user_code");
