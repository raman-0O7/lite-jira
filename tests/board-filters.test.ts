import { describe, expect, it } from "vitest";

import type { IssueCard } from "@/lib/api/projects";
import {
  activeFilterCount,
  assigneeToken,
  EMPTY_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  matchesFilters,
} from "@/lib/board-filters";

const card = (patch: Partial<IssueCard>) =>
  ({ title: "Issue", priority: "MEDIUM", labels: [], dueDate: null, assignee: null, assigneeAgent: null, ...patch }) as IssueCard;

const ada = card({ assignee: { id: "u1", name: "Ada", image: null } });
const claude = card({ assigneeAgent: { id: "a1", name: "Claude", kind: "CLAUDE_CODE" } });
const nobody = card({});

describe("assignee filter", () => {
  it("tokens people, agents and nobody", () => {
    expect([ada, claude, nobody].map(assigneeToken)).toEqual(["user:u1", "agent:a1", "none"]);
  });

  it("matches any selected assignee; empty matches all", () => {
    const pick = (assignees: string[]) =>
      [ada, claude, nobody].filter((t) => matchesFilters(t, { ...EMPTY_FILTERS, assignees }));
    expect(pick([])).toHaveLength(3);
    expect(pick(["agent:a1", "none"])).toEqual([claude, nobody]);
    expect(pick(["user:u1"])).toEqual([ada]);
    expect(activeFilterCount({ ...EMPTY_FILTERS, assignees: ["none"] })).toBe(1);
  });

  it("round-trips through the URL and drops junk", () => {
    const params = filtersToSearchParams({ ...EMPTY_FILTERS, assignees: ["user:u1", "none"] }, new URLSearchParams("view=list"));
    expect(params.get("assignee")).toBe("user:u1,none");
    expect(params.get("view")).toBe("list");
    expect(filtersFromSearchParams(new URLSearchParams("assignee=user:u1,<script>,agent:a1")).assignees).toEqual([
      "user:u1",
      "agent:a1",
    ]);
  });
});
