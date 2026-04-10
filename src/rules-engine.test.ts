import { describe, it, expect } from "vitest";
import type { MonitorContext, StateClient } from "./rules-engine.js";
import { runRules } from "./rules-engine.js";
import type { RuleConfig } from "./config.js";
import "./custom-rules.js";

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
  it("when.functions matches if any signature matches (bare name)", async () => {
    const ctx = mkCtx({
      functionName: "proposePriceFor",
      functionSignature:
        "function proposePriceFor(address,address,bytes32,uint256,bytes,int256)",
      caller: "0x0000000000000000000000000000000000000002",
      args: [1, 2, 3, 4, 5, 999],
    });
    const rules: RuleConfig[] = [
      {
        when: { functions: ["proposePriceFor", "proposePrice"] },
        checks: [
          {
            type: "callerNotIn",
            allowed: ["0x0000000000000000000000000000000000000001"],
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, dummyState);
    expect(res).toHaveLength(1);
  });

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

  it("merges callerNotIn with allowedFromCall (mock callView)", async () => {
    const stateWithCall: StateClient = {
      ...dummyState,
      async callView() {
        return [
          "0xallowed0000000000000000000000000000000001",
          "0xfeed000000000000000000000000000000000001",
        ];
      },
    };
    const ctx = mkCtx({
      caller: "0xfeed000000000000000000000000000000000001",
      args: [],
    });
    const rules: RuleConfig[] = [
      {
        checks: [
          {
            type: "callerNotIn",
            allowed: [],
            allowedFromCall: {
              contract: "0x0000000000000000000000000000000000000002",
              signature:
                "function getWhitelist() view returns (address[])",
              cacheSeconds: 0,
            },
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, stateWithCall);
    expect(res).toHaveLength(0);
  });

  it("callerNotIn allowedFromCall returns bool (mapping getter)", async () => {
    let sawArg: unknown;
    const stateWithCall: StateClient = {
      ...dummyState,
      async callView(_c: string, _sig: string, args?: unknown[]) {
        sawArg = args?.[0];
        return false;
      },
    };
    const ctx = mkCtx({
      caller: "0x0000000000000000000000000000000000000001",
      args: [],
    });
    const rules: RuleConfig[] = [
      {
        checks: [
          {
            type: "callerNotIn",
            allowed: [],
            allowedFromCall: {
              contract: "0x0000000000000000000000000000000000000002",
              signature:
                "function isProposerWhitelisted(address) view returns (bool)",
              args: ["$caller"],
              returns: "bool",
              cacheSeconds: 0,
            },
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, stateWithCall);
    expect(res).toHaveLength(1);
    expect(String(sawArg)).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("callerNotIn bool uses $arg0 for mapping check", async () => {
    let passedAddr: unknown;
    const stateWithCall: StateClient = {
      ...dummyState,
      async callView(_c: string, _sig: string, args?: unknown[]) {
        passedAddr = args?.[0];
        return true;
      },
    };
    const ctx = mkCtx({
      caller: "0x0000000000000000000000000000000000000999",
      args: ["0x0000000000000000000000000000000000000001", "0x02"],
    });
    const rules: RuleConfig[] = [
      {
        checks: [
          {
            type: "callerNotIn",
            allowed: [],
            allowedFromCall: {
              contract: "0x0000000000000000000000000000000000000002",
              signature:
                "function isProposerWhitelisted(address) view returns (bool)",
              args: ["$arg0"],
              returns: "bool",
              cacheSeconds: 0,
            },
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, stateWithCall);
    expect(res).toHaveLength(0);
    expect(String(passedAddr).toLowerCase()).toContain("0000000000000000000000000000000000000001");
  });

  it("callerNotIn bool true does not alert", async () => {
    const stateWithCall: StateClient = {
      ...dummyState,
      async callView() {
        return true;
      },
    };
    const ctx = mkCtx({
      caller: "0xbad000000000000000000000000000000000001",
      args: [],
    });
    const rules: RuleConfig[] = [
      {
        checks: [
          {
            type: "callerNotIn",
            allowed: [],
            allowedFromCall: {
              contract: "0x0000000000000000000000000000000000000002",
              signature:
                "function isProposerWhitelisted(address) view returns (bool)",
              args: ["$caller"],
              returns: "bool",
              cacheSeconds: 0,
            },
          },
        ],
      },
    ];
    const res = await runRules(ctx, rules, stateWithCall);
    expect(res).toHaveLength(0);
  });

  it("alertIfNotAnyRole: no alert when hasRole returns true", async () => {
    const state: StateClient = {
      ...dummyState,
      async callView() {
        return true;
      },
    };
    const ctx = mkCtx({
      functionName: "updatePrice",
      caller: "0x1111111111111111111111111111111111111111",
      args: [1000n],
    });
    const rules: RuleConfig[] = [
      {
        name: "oracle-price",
        handler: "alertIfNotAnyRole",
        params: {
          contract: "0xCe9a6626Eb99eaeA829D7fA613d5D0A2eaE45F40",
          functionNames: ["updatePrice"],
          roleHashes: ["0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929"],
        },
      },
    ];
    const res = await runRules(ctx, rules, state);
    expect(res).toHaveLength(0);
  });

  it("alertIfNotAnyRole: alert when hasRole always false", async () => {
    const state: StateClient = {
      ...dummyState,
      async callView() {
        return false;
      },
    };
    const ctx = mkCtx({
      functionName: "updatePrice",
      caller: "0x2222222222222222222222222222222222222222",
      args: [1000n],
    });
    const rules: RuleConfig[] = [
      {
        name: "oracle-price",
        handler: "alertIfNotAnyRole",
        params: {
          contract: "0xCe9a6626Eb99eaeA829D7fA613d5D0A2eaE45F40",
          functionNames: ["updatePrice"],
          roleHashes: [
            "0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929",
            "0x0000000000000000000000000000000000000000000000000000000000000000",
          ],
        },
      },
    ];
    const res = await runRules(ctx, rules, state);
    expect(res).toHaveLength(1);
    expect(res[0]!.matched).toBe(true);
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

