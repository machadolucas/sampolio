CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `balance_snapshot` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE INDEX `balance_snapshot_seq` ON `balance_snapshot` (`userId`,`seq`);--> statement-breakpoint
CREATE TABLE `bank_connection` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `bank_session_secret` (
	`userId` text NOT NULL,
	`connectionId` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `connectionId`)
);
--> statement-breakpoint
CREATE TABLE `bank_sync_run` (
	`userId` text NOT NULL,
	`connectionId` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `connectionId`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `bank_transaction` (
	`userId` text NOT NULL,
	`linkedAccountId` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `linkedAccountId`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `budget` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `debt` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `debt_extra_payment` (
	`userId` text NOT NULL,
	`debtId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `debtId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `debt_reference_rate` (
	`userId` text NOT NULL,
	`debtId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `debtId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `fin_account` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `goal` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `investment` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `investment_contribution` (
	`userId` text NOT NULL,
	`investmentId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `investmentId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mortgage` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mortgage_actual` (
	`mortgageId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`mortgageId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mortgage_balance_snapshot` (
	`mortgageId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`mortgageId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mortgage_cost` (
	`mortgageId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`mortgageId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mortgage_extra_payment` (
	`mortgageId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`mortgageId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mortgage_member_index` (
	`userId` text NOT NULL,
	`mortgageId` text NOT NULL,
	`seq` integer NOT NULL,
	PRIMARY KEY(`userId`, `mortgageId`)
);
--> statement-breakpoint
CREATE TABLE `mortgage_rate` (
	`mortgageId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`mortgageId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `planned_item` (
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `accountId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `receivable` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `receivable_repayment` (
	`userId` text NOT NULL,
	`receivableId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `receivableId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_adjustment` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE INDEX `reconciliation_adjustment_seq` ON `reconciliation_adjustment` (`userId`,`seq`);--> statement-breakpoint
CREATE TABLE `reconciliation_session` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE INDEX `reconciliation_session_seq` ON `reconciliation_session` (`userId`,`seq`);--> statement-breakpoint
CREATE TABLE `recurring_item` (
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `accountId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `salary_config` (
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `accountId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `split_expense` (
	`groupId` text NOT NULL,
	`id` text NOT NULL,
	`yearMonth` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`groupId`, `id`)
);
--> statement-breakpoint
CREATE INDEX `split_expense_month` ON `split_expense` (`groupId`,`yearMonth`,`seq`);--> statement-breakpoint
CREATE TABLE `split_group` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `split_group_member_index` (
	`userId` text NOT NULL,
	`groupId` text NOT NULL,
	`seq` integer NOT NULL,
	PRIMARY KEY(`userId`, `groupId`)
);
--> statement-breakpoint
CREATE TABLE `split_group_summary` (
	`groupId` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `taxed_income` (
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `accountId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `trip` (
	`userId` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`userId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`userId` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
