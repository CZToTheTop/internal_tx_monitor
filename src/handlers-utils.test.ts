import { describe, it, expect } from "vitest";
import {
  normSelector,
  escapeHtml,
  normalizeTxHash,
  getTargetMethodSelectors,
  matchLogToTargets,
  matchTxToTargets,
  matchTraceToTargets,
  parseBlockNumber,
  inList,
  addrEq,
} from "./handlers-utils.js";
import type { MonitorTarget } from "./config.js";

describe("normSelector", () => {
  it("normalizes string selector", () => {
    expect(normSelector("0xa9059cbb")).toBe("0xa9059cbb");
    expect(normSelector("0x56055f7d")).toBe("0x56055f7d");
  });
  it("handles array input", () => {
    expect(normSelector(["0xa9059cbb"])).toBe("0xa9059cbb");
  });
  it("pads short selector", () => {
    expect(normSelector("0xab")).toBe("0xab000000");
  });
  it("returns null for invalid", () => {
    expect(normSelector(null)).toBeNull();
    expect(normSelector(123)).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes special chars", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    expect(escapeHtml('"x"')).toBe("&quot;x&quot;");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });
});

describe("normalizeTxHash", () => {
  it("normalizes valid 64-char hex", () => {
    const hex64 = "a".repeat(64);
    expect(normalizeTxHash("0x" + hex64)).toBe("0x" + hex64);
    const txHash = "0x" + "c29d220ca1aebe969fbbf3e0af5a0d5bd11ff1ff8859b79f4f3ec159c2a36a17";
    expect(normalizeTxHash(txHash)).toBe(txHash.toLowerCase());
  });
  it("returns null for invalid", () => {
    expect(normalizeTxHash("0x123")).toBeNull();
    expect(normalizeTxHash("")).toBeNull();
    expect(normalizeTxHash(null)).toBeNull();
  });
});

describe("addrEq", () => {
  it("compares addresses case-insensitive", () => {
    expect(addrEq("0xABC", "0xabc")).toBe(true);
    expect(addrEq("0xabc", "0xABC")).toBe(true);
    expect(addrEq("0xa", "0xb")).toBe(false);
  });
  it("returns false for non-string", () => {
    expect(addrEq("0xa", [])).toBe(false);
    expect(addrEq(undefined, "0xa")).toBe(false);
  });
});

describe("inList", () => {
  it("matches when addr in list", () => {
    expect(inList("0xa", ["0xa", "0xb"])).toBe(true);
  });
  it("empty list means any", () => {
    expect(inList("0xa", [])).toBe(true);
  });
  it("no match", () => {
    expect(inList("0xc", ["0xa", "0xb"])).toBe(false);
  });
});

describe("getTargetMethodSelectors", () => {
  it("returns selectors for internal_calls", () => {
    const t: MonitorTarget = {
      type: "internal_calls",
      addresses: [],
      methodSelectors: ["0xa9059cbb", "0x56055f7d"],
    };
    expect(getTargetMethodSelectors(t)).toEqual(["0xa9059cbb", "0x56055f7d"]);
  });
  it("returns [] for non-internal_calls", () => {
    const t: MonitorTarget = { type: "events", addresses: [] };
    expect(getTargetMethodSelectors(t)).toEqual([]);
  });
});

describe("matchLogToTargets", () => {
  const targets: MonitorTarget[] = [
    { type: "events", addresses: ["0xaaa"], topics: ["0xt1"], label: "A" },
    { type: "events", addresses: ["0xbbb"], topics: [], label: "B" },
  ];
  it("matches address and topic", () => {
    const r = matchLogToTargets(
      { account: { address: "0xaaa" }, topics: ["0xt1"] },
      targets
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.label).toBe("A");
  });
  it("no match for wrong topic", () => {
    const r = matchLogToTargets(
      { account: { address: "0xaaa" }, topics: ["0xt2"] },
      targets
    );
    expect(r).toHaveLength(0);
  });
});

describe("matchTxToTargets", () => {
  const targets: MonitorTarget[] = [
    { type: "transactions", addresses: [], txFrom: ["0xfrom"], txTo: ["0xto"], label: "T1" },
  ];
  it("matches from and to", () => {
    const r = matchTxToTargets(
      { from: { address: "0xfrom" }, to: { address: "0xto" } },
      targets
    );
    expect(r).toHaveLength(1);
  });
  it("no match for wrong to", () => {
    const r = matchTxToTargets(
      { from: { address: "0xfrom" }, to: { address: "0xother" } },
      targets
    );
    expect(r).toHaveLength(0);
  });
});

describe("matchTraceToTargets", () => {
  const targets: MonitorTarget[] = [
    {
      type: "internal_calls",
      addresses: [],
      fromAddresses: ["0xfrom"],
      toAddresses: ["0xto"],
      methodSelectors: ["0xa9059cbb"],
      label: "Trace1",
    },
  ];
  it("matches from, to, and selector", () => {
    const r = matchTraceToTargets(
      { from: { address: "0xfrom" }, to: { address: "0xto" }, input: "0xa9059cbb1234" },
      targets
    );
    expect(r).toHaveLength(1);
  });
  it("no match for wrong selector", () => {
    const r = matchTraceToTargets(
      { from: { address: "0xfrom" }, to: { address: "0xto" }, input: "0x12345678" },
      targets
    );
    expect(r).toHaveLength(0);
  });
});

describe("parseBlockNumber", () => {
  it("parses number", () => {
    expect(parseBlockNumber(12345)).toBe(12345);
  });
  it("parses hex string", () => {
    expect(parseBlockNumber("0x3039")).toBe(12345);
  });
  it("returns null for invalid", () => {
    expect(parseBlockNumber("abc")).toBeNull();
    expect(parseBlockNumber(null)).toBeNull();
  });
});
