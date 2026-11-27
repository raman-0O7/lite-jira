/**
 * The MCP tool contract (docs/features/23-connect-your-ai.md "Tool contract
 * test"). ChatGPT keeps a frozen snapshot of a server's tools once an admin
 * publishes it, and calls that no longer match it fail. This compares the
 * current tools with a checked-in snapshot and sorts every difference into
 * "breaking" (fails the test) or "compatible" (needs a snapshot update).
 *
 * Descriptions and titles aren't part of the contract: changing them never
 * breaks a client, so they're left out of the snapshot to keep it quiet.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };

export type ToolContract = {
  name: string;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  inputSchema: Schema;
};

const IGNORED_KEYS = new Set(["description", "title", "$schema", "examples"]);

/** A schema without descriptions, with object keys sorted, so snapshots diff cleanly. */
function normalize(value: Json): Json {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      if (IGNORED_KEYS.has(key)) continue;
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

/** The contract of each tool, sorted by name, from a `tools/list` result. */
export function toContracts(
  tools: { name: string; annotations?: Record<string, unknown>; inputSchema?: Record<string, unknown> }[],
): ToolContract[] {
  return tools
    .map((tool) => {
      const a = tool.annotations ?? {};
      const annotations: ToolContract["annotations"] = {};
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        if (typeof a[key] === "boolean") annotations[key] = a[key] as boolean;
      }
      return { name: tool.name, annotations, inputSchema: normalize((tool.inputSchema ?? {}) as Json) as Schema };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ContractDiff = { breaking: string[]; compatible: string[] };

const asSchema = (value: Json | undefined): Schema | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

const types = (schema: Schema): string[] | null => {
  const t = schema.type;
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return null;
};

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** Lower bounds a value must meet: a higher one in the new schema narrows it. */
const LOWER_BOUNDS = ["minLength", "minimum", "exclusiveMinimum", "minItems", "minProperties"] as const;
/** Upper bounds: a lower one in the new schema narrows it. */
const UPPER_BOUNDS = ["maxLength", "maximum", "exclusiveMaximum", "maxItems", "maxProperties"] as const;

function compareSchema(path: string, before: Schema, after: Schema, diff: ContractDiff) {
  // Types: every type accepted before must still be accepted.
  const tBefore = types(before);
  const tAfter = types(after);
  if (tAfter && (!tBefore || tBefore.some((t) => !tAfter.includes(t) && !(t === "integer" && tAfter.includes("number"))))) {
    diff.breaking.push(`${path}: type narrowed from ${tBefore?.join("|") ?? "any"} to ${tAfter.join("|")}`);
  } else if (tBefore && !same(tBefore, tAfter)) {
    diff.compatible.push(`${path}: type widened to ${tAfter?.join("|") ?? "any"}`);
  }

  // Enums and constants: every value accepted before must still be accepted.
  const eBefore = Array.isArray(before.enum) ? before.enum : null;
  const eAfter = Array.isArray(after.enum) ? after.enum : null;
  if (eAfter) {
    const lost = eBefore ? eBefore.filter((v) => !eAfter.some((w) => same(v, w))) : null;
    if (!eBefore) diff.breaking.push(`${path}: now limited to ${JSON.stringify(eAfter)}`);
    else if (lost && lost.length) diff.breaking.push(`${path}: no longer accepts ${lost.map((v) => JSON.stringify(v)).join(", ")}`);
    else if (!same(eBefore, eAfter)) diff.compatible.push(`${path}: accepts more values`);
  } else if (eBefore) {
    diff.compatible.push(`${path}: no longer limited to a list of values`);
  }
  if (after.const !== undefined && !same(before.const, after.const)) {
    diff.breaking.push(`${path}: now must be ${JSON.stringify(after.const)}`);
  }

  for (const key of LOWER_BOUNDS) {
    const b = before[key];
    const a = after[key];
    if (typeof a === "number" && (typeof b !== "number" || a > b)) diff.breaking.push(`${path}: ${key} raised to ${a}`);
    else if (typeof b === "number" && (typeof a !== "number" || a < b)) diff.compatible.push(`${path}: ${key} relaxed`);
  }
  for (const key of UPPER_BOUNDS) {
    const b = before[key];
    const a = after[key];
    if (typeof a === "number" && (typeof b !== "number" || a < b)) diff.breaking.push(`${path}: ${key} lowered to ${a}`);
    else if (typeof b === "number" && (typeof a !== "number" || a > b)) diff.compatible.push(`${path}: ${key} relaxed`);
  }
  for (const key of ["pattern", "format"] as const) {
    if (after[key] !== undefined && !same(before[key], after[key])) diff.breaking.push(`${path}: ${key} changed`);
    else if (before[key] !== undefined && after[key] === undefined) diff.compatible.push(`${path}: ${key} removed`);
  }

  // Object properties.
  const pBefore = asSchema(before.properties) ?? {};
  const pAfter = asSchema(after.properties) ?? {};
  const required = (s: Schema) => new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const rBefore = required(before);
  const rAfter = required(after);
  for (const name of Object.keys(pBefore)) {
    const prop = `${path}.${name}`;
    const b = asSchema(pBefore[name]);
    const a = asSchema(pAfter[name]);
    if (!a) {
      diff.breaking.push(`${prop}: input removed`);
      continue;
    }
    if (rAfter.has(name) && !rBefore.has(name)) diff.breaking.push(`${prop}: now required`);
    else if (rBefore.has(name) && !rAfter.has(name)) diff.compatible.push(`${prop}: now optional`);
    if (b) compareSchema(prop, b, a, diff);
  }
  for (const name of Object.keys(pAfter)) {
    if (name in pBefore) continue;
    if (rAfter.has(name)) diff.breaking.push(`${path}.${name}: new required input`);
    else diff.compatible.push(`${path}.${name}: new optional input`);
  }
  if (before.additionalProperties !== false && after.additionalProperties === false && Object.keys(pBefore).length === 0) {
    diff.breaking.push(`${path}: no longer accepts extra inputs`);
  }

  // Array items.
  const iBefore = asSchema(before.items);
  const iAfter = asSchema(after.items);
  if (iBefore && iAfter) compareSchema(`${path}[]`, iBefore, iAfter, diff);
  else if (!iBefore && iAfter) diff.breaking.push(`${path}[]: items now constrained`);

  // Unions: every option accepted before must still be offered, unchanged.
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const b = Array.isArray(before[key]) ? before[key] : null;
    const a = Array.isArray(after[key]) ? after[key] : null;
    if (!b && !a) continue;
    if (key === "allOf") {
      if (!same(b, a)) diff.breaking.push(`${path}: ${key} changed`);
      continue;
    }
    if (!b) diff.breaking.push(`${path}: now restricted by ${key}`);
    else if (!a) diff.compatible.push(`${path}: ${key} removed`);
    else if (b.some((option) => !a.some((other) => same(option, other)))) diff.breaking.push(`${path}: ${key} option removed or changed`);
    else if (a.length > b.length) diff.compatible.push(`${path}: ${key} option added`);
  }
}

/** Every difference between the snapshot (`before`) and the current tools (`after`). */
export function compareContracts(before: ToolContract[], after: ToolContract[]): ContractDiff {
  const diff: ContractDiff = { breaking: [], compatible: [] };
  const current = new Map(after.map((tool) => [tool.name, tool]));
  const previous = new Set(before.map((tool) => tool.name));

  for (const old of before) {
    const tool = current.get(old.name);
    if (!tool) {
      diff.breaking.push(`${old.name}: tool removed or renamed`);
      continue;
    }
    // A tool that was read-only, or not destructive, must not become riskier: clients
    // (ChatGPT especially) decide when to ask for confirmation from these hints.
    const lostReadOnly = old.annotations.readOnlyHint === true && tool.annotations.readOnlyHint !== true;
    const nowDestructive = old.annotations.destructiveHint !== true && tool.annotations.destructiveHint === true;
    if (lostReadOnly) diff.breaking.push(`${old.name}: no longer read-only`);
    if (nowDestructive) diff.breaking.push(`${old.name}: now destructive`);
    if (!lostReadOnly && !nowDestructive && !same(old.annotations, tool.annotations)) {
      diff.compatible.push(`${old.name}: annotations changed`);
    }
    compareSchema(old.name, old.inputSchema, tool.inputSchema, diff);
  }
  for (const tool of after) {
    if (!previous.has(tool.name)) diff.compatible.push(`${tool.name}: new tool`);
  }
  return diff;
}
