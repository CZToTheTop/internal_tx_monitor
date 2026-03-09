import express, { Request, Response } from "express";
import { isValidSignature, type AlchemyWebhookEvent } from "./webhook-util.js";

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
  signingKeys: string[];
  onEvent: (event: AlchemyWebhookEvent) => void | Promise<void>;
}

/**
 * 创建并启动 Webhook 接收服务器
 * 支持多个 signing key（每个 webhook 一个）
 */
export function createServer(options: ServerOptions): express.Express {
  const { signingKeys, onEvent } = options;
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

  app.post(WEBHOOK_PATH, async (req: Request, res: Response) => {
    try {
      const signature = req.headers["x-alchemy-signature"] as string | undefined;
      const skipValidation = process.env.SKIP_SIGNATURE_VALIDATION === "true";

      if (!signature && !skipValidation) {
        res.status(401).send("Missing x-alchemy-signature");
        return;
      }

      const body = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
      const valid =
        skipValidation ||
        (signingKeys.length > 0 &&
          signingKeys.some((key) => isValidSignature(body, signature!, key)));

      if (!valid) {
        res.status(401).send("Invalid signature");
        return;
      }

      const event = req.body as AlchemyWebhookEvent;
      await onEvent(event);
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
  app.listen(port, host);
}
