CREATE TABLE `child_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`slot_key` text DEFAULT 'hero' NOT NULL,
	`name` text NOT NULL,
	`gender` text NOT NULL,
	`photo_path` text NOT NULL,
	`feature_card` text,
	`sheets` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`kind` text NOT NULL,
	`slot_key` text DEFAULT 'hero' NOT NULL,
	`age_stage` text DEFAULT 'child' NOT NULL,
	`view` text DEFAULT 'front' NOT NULL,
	`mask_path` text NOT NULL,
	`original_words` text,
	`new_words_template` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`settings_version` integer NOT NULL,
	`est_cost` real DEFAULT 0 NOT NULL,
	`actual_cost` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scene_renders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`version` integer NOT NULL,
	`candidate` integer NOT NULL,
	`status` text NOT NULL,
	`qa_scores` text,
	`qa_reason` text,
	`output_size` text,
	`output_path` text,
	`composite_path` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`ms` integer DEFAULT 0 NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`inputs` text NOT NULL,
	`prompt_version` text NOT NULL,
	`settings_version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scene_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`status` text NOT NULL,
	`path` text,
	`flagged_instances` text DEFAULT '[]' NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`outside_union_identical` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`original_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`values` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`note` text
);
