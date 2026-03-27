import { describe, it, expect } from "vitest";
import type { MonitorContext, StateClient } from "./rules-engine.js";
import { runRules } from "./rules-engine.js";
import type { RuleConfig } from "./config.js";

const dummyState: StateClient = {
  async getNativeBalance() {
    return BigInt(1000);
  },
  async getTokenBalance() {
    return BigInt(500);
  },
  async getStorage() {
    return "0x01";
  },
};

function mkCtx(partial: Partial<MonitorContext>): MonitorContext {
  return {
    kind: "internal_call",
    network: "ETH_MAINNET",
    target: {
      type: "internal_calls",
      addresses: ["0x0000000000000000000000000000000000000001"],
      label: "Test",
    },
    ...partial,
  };
}

describe("rules-engine runRules", () => {
  it("triggers paramIn when value not allowed", async () => {
    const ctx = mkCtx({
      functionName: "revokeRole",
      args: ["0xdead", "0xbeef"],
    });

    const rules: RuleConfig[] = [
      {
        name: "disallow-unknown-role",
        when: { function: "revokeRole" },
        checks: [
          {
            type: "paramIn",
            argIndex: 0,
            allowed: ["0x01", "0x02"],
          },
        ],
      },
    ];

    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(1);
    expect(res[0]!.rule.name).toBe("disallow-unknown-role");
    expect(res[0]!.matched).toBe(true);
  });

  it("does not trigger paramIn when value allowed", async () => {
    const ctx = mkCtx({
      functionName: "revokeRole",
      args: ["0x01", "0xbeef"],
    });

    const rules: RuleConfig[] = [
      {
        when: { function: "revokeRole" },
        checks: [
          {
            type: "paramIn",
            argIndex: 0,
            allowed: ["0x01", "0x02"],
          },
        ],
      },
    ];

    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(0);
  });

  it("triggers balanceInRange when balance out of range", async () => {
    const ctx = mkCtx({});
    const rules: RuleConfig[] = [
      {
        checks: [
          {
            type: "balanceInRange",
            addressRef: "target",
            token: "native",
            min: 2000,
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(1);
    expect(res[0]!.matched).toBe(true);
  });

  it("triggers storageSlotEquals when storage not equal", async () => {
    const ctx = mkCtx({});
    const rules: RuleConfig[] = [
      {
        checks: [
          {
            type: "storageSlotEquals",
            slot: "0x00",
            expected: "0x02",
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(1);
    expect(res[0]!.matched).toBe(true);
  });

  it("triggers callerNotIn when caller not in allowed list", async () => {
    const ctx = mkCtx({
      caller: "0xbad0000000000000000000000000000000000001",
      args: [],
    });
    const rules: RuleConfig[] = [
      {
        name: "oracle-only",
        checks: [
          {
            type: "callerNotIn",
            allowed: ["0xallowed0000000000000000000000000000000001"],
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(1);
    expect(res[0]!.matched).toBe(true);
  });

  it("does not trigger callerNotIn when caller in allowed list", async () => {
    const ctx = mkCtx({
      caller: "0xallowed0000000000000000000000000000000001",
      args: [],
    });
    const rules: RuleConfig[] = [
      {
        checks: [{ type: "callerNotIn", allowed: ["0xallowed0000000000000000000000000000000001"] }],
      },
    ];
    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(0);
  });

  it("triggers paramOutsideRange when param above max", async () => {
    const ctx = mkCtx({
      functionName: "prepareMarket",
      args: [600],
    });
    const rules: RuleConfig[] = [
      {
        when: { function: "prepareMarket" },
        checks: [{ type: "paramOutsideRange", argIndex: 0, max: 500 }],
      },
    ];
    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(1);
    expect(res[0]!.reason).toContain("大于 max");
  });
});

