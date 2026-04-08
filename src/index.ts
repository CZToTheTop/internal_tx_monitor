import "dotenv/config";
import { loadConfigsFromEnv } from "./config.js";
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
const app = createServer({
  port: PORT,
  host: HOST,
  configs,
  signingKeys,
  onEvent: createEventHandler(),
});

startServer(app, PORT, HOST);
