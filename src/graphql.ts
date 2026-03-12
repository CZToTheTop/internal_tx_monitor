import type { Config, MonitorTarget } from "./config.js";

/**
 * 构建 Events 监控的 GraphQL 查询
 * 监控指定合约发出的事件
 */
export function buildEventsQuery(target: MonitorTarget): string {
  const addrs = target.addresses.map((a) => `"${a}"`).join(", ");
  const topics = target.topics?.length
    ? `["${target.topics.join('", "')}"]`
    : "[]";

  return `
{
  block {
    number
    hash
    timestamp
    logs(filter: {addresses: [${addrs}], topics: ${topics}}) {
      account {
        address
      }
      topics
      data
      index
      transaction {
        hash
        index
        from { address }
        to { address }
        value
        gas
        gasUsed
        status
      }
    }
  }
}
`.trim();
}

/**
 * 构建 External Transactions 监控的 GraphQL 查询
 * 监控发往/来自指定地址的外部交易
 */
export function buildTransactionsQuery(target: MonitorTarget): string {
  const fromList = (target.txFrom ?? target.addresses).filter(Boolean);
  const toList = (target.txTo ?? target.addresses).filter(Boolean);
  const fromStr = `from: [${fromList.map((a) => `"${a}"`).join(", ")}]`;
  const toStr = `to: [${toList.map((a) => `"${a}"`).join(", ")}]`;
  const filter = `{ addresses: [ { ${fromStr}, ${toStr} } ] }`;

  return `
{
  block {
    number
    hash
    timestamp
    transactions(filter: ${filter}) {
      hash
      index
      from { address }
      to { address }
      value
      gas
      gasUsed
      status
    }
  }
}
`.trim();
}

/**
 * 构建 Internal Calls 监控的 GraphQL 查询
 * 使用 callTracerTraces 捕获内部调用 (call/delegatecall/create)
 */
function ensureAddressArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}

export function buildInternalCallsQuery(target: MonitorTarget): string {
  const fromList = ensureAddressArray(target.fromAddresses);
  const toList = ensureAddressArray(target.toAddresses ?? target.addresses);
  const fromStr = `from: [${fromList.map((a) => `"${a}"`).join(", ")}]`;
  const toStr = `to: [${toList.map((a) => `"${a}"`).join(", ")}]`;
  const filter = `{ addresses: [ { ${fromStr}, ${toStr} } ] }`;

  return `
{
  block {
    number
    hash
    timestamp
    callTracerTraces(filter: ${filter}) {
      from { address }
      to { address }
      type
      value
      gas
      gasUsed
      input
      output
      error
      revertReason
      subtraceCount
      traceAddressPath
      transaction { hash }
    }
  }
}
`.trim();
}

export function buildGraphQLQuery(target: MonitorTarget): string {
  switch (target.type) {
    case "events":
      return buildEventsQuery(target);
    case "transactions":
      return buildTransactionsQuery(target);
    case "internal_calls":
      return buildInternalCallsQuery(target);
    default:
      throw new Error(`Unknown monitor type: ${(target as MonitorTarget).type}`);
  }
}

/** 单 Webhook 模式：合并所有 target 的过滤条件，生成一条 GraphQL，在服务端再按 target 做多维筛查 */
export function buildMergedQuery(config: Config): string {
  const eventTargets = config.targets.filter((t) => t.type === "events");
  const txTargets = config.targets.filter((t) => t.type === "transactions");
  const internalTargets = config.targets.filter((t) => t.type === "internal_calls");

  const eventAddrs = new Set<string>();
  const eventTopics = new Set<string>();
  for (const t of eventTargets) {
    for (const a of t.addresses ?? []) if (a) eventAddrs.add(a);
    for (const top of t.topics ?? []) if (top) eventTopics.add(top);
  }

  const txFromSet = new Set<string>();
  const txToSet = new Set<string>();
  for (const t of txTargets) {
    const fromList = t.txFrom ?? t.addresses ?? [];
    const toList = t.txTo ?? t.addresses ?? [];
    for (const a of fromList) if (a) txFromSet.add(a);
    for (const a of toList) if (a) txToSet.add(a);
  }

  const internalFromSet = new Set<string>();
  const internalToSet = new Set<string>();
  for (const t of internalTargets) {
    for (const a of ensureAddressArray(t.fromAddresses)) internalFromSet.add(a);
    for (const a of ensureAddressArray(t.toAddresses ?? t.addresses)) internalToSet.add(a);
  }

  const parts: string[] = ["block {", "  number", "  hash", "  timestamp"];

  if (eventTargets.length > 0 && eventAddrs.size > 0) {
    const addrs = [...eventAddrs].map((a) => `"${a}"`).join(", ");
    const topics = eventTopics.size > 0 ? `["${[...eventTopics].join('", "')}"]` : "[]";
    parts.push(
      `  logs(filter: { addresses: [${addrs}], topics: ${topics} }) {`,
      "    account { address }",
      "    topics",
      "    data",
      "    index",
      "    transaction { hash index from { address } to { address } value gas gasUsed status }",
      "  }"
    );
  }

  if (txTargets.length > 0 && (txFromSet.size > 0 || txToSet.size > 0)) {
    const fromStr = `from: [${[...txFromSet].map((a) => `"${a}"`).join(", ")}]`;
    const toStr = `to: [${[...txToSet].map((a) => `"${a}"`).join(", ")}]`;
    const filter = `{ addresses: [ { ${fromStr}, ${toStr} } ] }`;
    parts.push(
      `  transactions(filter: ${filter}) {`,
      "    hash",
      "    index",
      "    from { address }",
      "    to { address }",
      "    value",
      "    gas",
      "    gasUsed",
      "    status",
      "  }"
    );
  }

  if (internalTargets.length > 0 && (internalFromSet.size > 0 || internalToSet.size > 0)) {
    const fromStr = `from: [${[...internalFromSet].map((a) => `"${a}"`).join(", ")}]`;
    const toStr = `to: [${[...internalToSet].map((a) => `"${a}"`).join(", ")}]`;
    const filter = `{ addresses: [ { ${fromStr}, ${toStr} } ] }`;
    parts.push(
      `  callTracerTraces(filter: ${filter}) {`,
      "    from { address }",
      "    to { address }",
      "    type",
      "    value",
      "    gas",
      "    gasUsed",
      "    input",
      "    output",
      "    error",
      "    revertReason",
      "    subtraceCount",
      "    traceAddressPath",
      "    transaction { hash }",
      "  }"
    );
  }

  parts.push("}");
  return `\n{\n${parts.join("\n")}\n}\n`.trim();
}
