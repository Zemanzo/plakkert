-- Note timestamps used to be stored in seconds; they are now stored in milliseconds.
UPDATE `notes` SET `created_at` = `created_at` * 1000, `updated_at` = `updated_at` * 1000, `deleted_at` = `deleted_at` * 1000;
