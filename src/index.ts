import "dotenv/config";
import { loadConfigsFromEnv } from "./config.js";
import { prefetchAbisForConfigs } from "./abi-prefetch.js";
import { createServer, startServer } from "./server.js";
import { createEventHandler } from "./handlers.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// 支持多个 signing key，逗号分隔
const signingKeysRaw = process.env.SIGNING_KEYS ?? process.env.SIGNING_KEY ?? "";
const signingKeys = signingKeysRaw
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const configs = loadConfigsFromEnv();
if (configs.length > 1) {
  console.log(`[monitor] 已加载 ${configs.length} 份配置: ${configs.map((c) => c.configPath ?? "?").join(", ")}`);
}

if (process.env.SKIP_ABI_PREFETCH !== "true") {
  const result = await prefetchAbisForConfigs(configs);
  const strict = process.env.ABI_PREFETCH_STRICT !== "false";
  if (result.failed.length > 0) {
    if (strict) {
      console.error(
        "[abi-prefetch] Startup aborted: set SKIP_ABI_PREFETCH=true to skip, or ABI_PREFETCH_STRICT=false to warn only."
      );
      process.exit(1);
    }
    console.warn(`[abi-prefetch] ${result.failed.length} contract(s) failed (ABI_PREFETCH_STRICT=false, continuing).`);
  }
}

const app = createServer({
  port: PORT,
  host: HOST,
  configs,
  signingKeys,
  onEvent: createEventHandler(),
});

startServer(app, PORT, HOST);
