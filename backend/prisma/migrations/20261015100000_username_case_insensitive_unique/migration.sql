-- Usernames are not case-sensitive: «Ali» and «ali» are one account. The existing
-- unique index stays; this one makes the database refuse names that differ only by case.
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));
