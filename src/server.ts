import express, { Request, Response } from "express";
import type { Config, MonitorTarget } from "./config.js";
import { getTargetForSignature, isValidSignature, type AlchemyWebhookEvent } from "./webhook-util.js";

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
  /** 从 config 的 target.signing_key 匹配入站请求，区分哪个监控 */
  config?: Config;
  /** 兼容旧版：未在 config 中配 signing_key 时用 env 的 key 列表 */
  signingKeys: string[];
  onEvent: (event: AlchemyWebhookEvent, matchedTarget?: MonitorTarget) => void | Promise<void>;
}

/**
 * 创建并启动 Webhook 接收服务器
 * 支持多个 signing key（每个 webhook 一个）
 */
export function createServer(options: ServerOptions): express.Express {
  const { config, signingKeys, onEvent } = options;
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
      // 单 Webhook 模式：用 config.targets 下的 signing_key（singleWebhookSigningKey）校验，不按 target 区分
      const validSingle =
        config?.singleWebhook &&
        config.singleWebhookSigningKey &&
        isValidSignature(body, signature!, config.singleWebhookSigningKey);
      const matchedTarget =
        !validSingle && config ? getTargetForSignature(config, body, signature!) : null;
      const validEnv = signingKeys.length > 0 && signingKeys.some((k) => isValidSignature(body, signature!, k));
      if (!validSingle && !matchedTarget && !validEnv) {
        res.status(401).send("Invalid signature");
        return;
      }
      await onEvent(event, validSingle ? undefined : matchedTarget ?? undefined);
      res.status(200).send("OK");
    } catch (err) {
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
