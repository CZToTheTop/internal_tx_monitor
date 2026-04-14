import { describe, it, expect } from "vitest";
import { buildMergedQuery } from "./graphql.js";
import type { Config } from "./config.js";

describe("buildMergedQuery", () => {
  it("merges all internal_calls toAddresses into one callTracerTraces filter", () => {
    const config: Config = {
      network: "ARB_MAINNET",
      webhookUrl: "https://x.com",
      singleWebhook: true,
      targets: [
        {
          type: "internal_calls",
          label: "A",
          addresses: ["0x1111111111111111111111111111111111111111"],
          toAddresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          methodSelectors: ["0x11111111"],
        },
        {
          type: "internal_calls",
          label: "B",
          addresses: ["0x2222222222222222222222222222222222222222"],
          toAddresses: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
          methodSelectors: ["0x22222222"],
        },
      ],
    };
    const q = buildMergedQuery(config);
    expect(q).toContain("callTracerTraces");
    expect(q).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(q).toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(q.match(/callTracerTraces/g)?.length).toBe(1);
  });
});
