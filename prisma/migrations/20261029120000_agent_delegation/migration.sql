-- Agents now work for a person who stays the assignee
-- (docs/features/17-personal-agents.md): give issues handed to an agent
-- before this its owner as their assignee.
UPDATE "Issue" AS i
SET "assigneeUserId" = a."ownerUserId"
FROM "Agent" AS a
WHERE i."assigneeAgentId" = a."id" AND i."assigneeUserId" IS NULL;
