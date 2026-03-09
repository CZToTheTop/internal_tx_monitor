import "dotenv/config";
import { loadConfig } from "./config.js";
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

const config = process.env.CONFIG_PATH ? loadConfig(process.env.CONFIG_PATH) : loadConfig();
const app = createServer({
  port: PORT,
  host: HOST,
  signingKeys,
  onEvent: createEventHandler(config),
});

startServer(app, PORT, HOST);
