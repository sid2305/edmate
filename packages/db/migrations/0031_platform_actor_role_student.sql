-- No later migration in the same deploy may use the 'student' value before this one commits
-- (ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement that uses it).
ALTER TYPE "public"."platform_actor_role" ADD VALUE 'student';