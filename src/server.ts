import express, { Request, Response } from "express";
import type { Config } from "./config.js";
import {
  resolveWebhookDispatch,
  type AlchemyWebhookEvent,
  type WebhookDispatch,
} from "./webhook-util.js";

const WEBHOOK_PATH = "/webhook";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export interface ServerOptions {
  port: number;
  host: string;
  /** 单文件兼容：等价于 configs: [config] */
  config?: Config;
  /** 多项目多 yaml：按签名命中对应 Config 再处理 */
  configs?: Config[];
  /** 兼容旧版：仅单 Config 时可用 env 的 key 列表兜底整表匹配 */
  signingKeys: string[];
  onEvent: (event: AlchemyWebhookEvent, dispatch: WebhookDispatch) => void | Promise<void>;
}

/**
 * 创建并启动 Webhook 接收服务器
 * 支持多个 signing key（每个 webhook 一个）
 */
export function createServer(options: ServerOptions): express.Express {
  const { signingKeys, onEvent } = options;
  const configs =
    options.configs?.length ? options.configs : options.config ? [options.config] : [];
  if (configs.length === 0) {
    throw new Error("createServer: 须提供 config 或 configs");
  }
  const app = express();

  app.use(
    express.json({
      limit: "10mb",
      verify: (req: Request, _res: Response, buf: Buffer) => {
        req.rawBody = buf;
      },
      strict: false,
    })
  );

  if (process.env.SKIP_SIGNATURE_VALIDATION === "true") {
    console.warn("[security] ⚠️ SKIP_SIGNATURE_VALIDATION=true — 生产环境请勿使用");
  }

  app.post(WEBHOOK_PATH, async (req: Request, res: Response) => {
    const event = req.body as AlchemyWebhookEvent;
    console.log(`[webhook] 收到请求 id=${event?.id ?? "-"} type=${event?.type ?? "-"}`);
    try {
      const signature = req.headers["x-alchemy-signature"] as string | undefined;
      const skipValidation = process.env.SKIP_SIGNATURE_VALIDATION === "true";

      if (!signature && !skipValidation) {
        res.status(401).send("Missing x-alchemy-signature");
        return;
      }

      const body = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
      const dispatch = resolveWebhookDispatch(configs, body, signature!, signingKeys);
      if (!dispatch) {
        res.status(401).send("Invalid signature");
        return;
      }
      if (configs.length > 1 && dispatch.config.configPath) {
        console.log(`[webhook] 命中配置 ${dispatch.config.configPath}`);
      }
      await onEvent(event, dispatch);
      res.status(200).send("OK");
    } catch (err) {
      console.error("[webhook] 处理异常:", err instanceof Error ? err.stack : err);
      res.status(500).send("Internal error");
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return app;
}

export function startServer(
  app: express.Express,
  port: number,
  host: string
): void {
  app.listen(port, host, () => {
    console.log(`Webhook: http://${host}:${port}/webhook`);
  });
}
