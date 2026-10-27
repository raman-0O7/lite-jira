import { describe, expect, it } from "vitest";

import { issueQueryToWhere, parseIssueQuery, QueryError } from "@/lib/query/issue-query";

describe("parseIssueQuery", () => {
  it("parses terms, comma lists, keys, and free text", () => {
    const q = parseIssueQuery('assignee:me type:bug,Story is:open label:"needs review" WEB-42 login "two words"');
    expect(q).toMatchObject({
      assignee: ["me"],
      type: ["BUG", "STORY"],
      is: ["open"],
      label: ["needs review"],
      keys: [{ projectKey: "WEB", number: 42 }],
      text: ["login", "two words"],
    });
  });

  it("accepts status aliases and epic/parent keys", () => {
    expect(parseIssueQuery("status:doing,done epic:web-1 parent:WEB-2")).toMatchObject({
      status: ["IN_PROGRESS", "DONE"],
      epic: [{ projectKey: "WEB", number: 1 }],
      parent: [{ projectKey: "WEB", number: 2 }],
    });
  });

  it.each([
    ["owner:me", /Unknown term "owner:"/],
    ["type:feature", /Unknown value "feature" for type:/],
    ["epic:bigthing", /expects an issue key/],
    ["label:", /needs a value/],
  ])("rejects %s", (input, message) => {
    expect(() => parseIssueQuery(input)).toThrow(QueryError);
    expect(() => parseIssueQuery(input)).toThrow(message);
  });

  it("treats a quoted key as text", () => {
    expect(parseIssueQuery('"WEB-42"')).toMatchObject({ keys: [], text: ["WEB-42"] });
  });
});

describe("issueQueryToWhere", () => {
  it("needs a user for assignee:me", () => {
    expect(() => issueQueryToWhere(parseIssueQuery("assignee:me"), { userId: null })).toThrow(QueryError);
  });

  it("is empty for an empty query", () => {
    expect(issueQueryToWhere(parseIssueQuery("   "), { userId: "u" })).toEqual({});
  });
});
