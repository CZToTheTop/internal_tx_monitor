import type { MonitorTarget } from "./config.js";

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
  const fromStr = fromList.length ? `from: [${fromList.map((a) => `"${a}"`).join(", ")}]` : "";
  const toStr = toList.length ? `to: [${toList.map((a) => `"${a}"`).join(", ")}]` : "";
  const filterParts = [fromStr, toStr].filter(Boolean).join(", ");
  const filter = filterParts ? `{addresses: [{${filterParts}}]}` : "{}";

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
  const fromStr = fromList.length ? `from: [${fromList.map((a) => `"${a}"`).join(", ")}]` : "";
  const toStr = toList.length ? `to: [${toList.map((a) => `"${a}"`).join(", ")}]` : "";
  const filterParts = [fromStr, toStr].filter(Boolean).join(", ");
  const filter = filterParts ? `{addresses: [{${filterParts}}]}` : "{}";

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
