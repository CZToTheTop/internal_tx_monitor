# Alchemy 链上监控 / Chain Monitor

基于 [Alchemy Notify API](https://docs.alchemy.com/docs/alchemy-notify) 的链上事件与**内部调用**监控。支持 Events、Transactions、Internal Calls，可选 Telegram 通知。

Monitors on-chain events and internal calls via Alchemy webhooks. Supports Events, Transactions, Internal Calls, with optional Telegram notifications.

---

## 中文

### 功能

- **Events**：监控指定合约发出的事件（logs）
- **Transactions**：监控发往/来自指定地址的外部交易
- **Internal Calls**：监控内部调用（`call` / `delegatecall` / `create`），含 `input` / `output` 等
- **Telegram**：可选推送到 TG

### 前置要求

1. [Alchemy](https://www.alchemy.com/) 账号
2. 公网可访问的 Webhook 地址（隧道或部署到服务器）
3. Auth Token：需先在 Dashboard 手动创建至少一个 Webhook 后，Webhooks 页面才会出现 AUTH TOKEN

### ⚠️ ngrok 免费版不适用于 Webhook

ngrok 免费版会显示插页，Alchemy 请求无法到达。建议：**Cloudflare Tunnel**、**localtunnel** 或部署到云服务器。

### 快速开始

```bash
npm install
cp config.example.yaml config.yaml
cp .env.example .env

# 1. 启动服务
npm run monitor

# 2. 另开终端启动隧道（本地开发）
cloudflared tunnel --url http://localhost:8080
# 将输出的 https://xxx.trycloudflare.com/webhook 填入 config.yaml

# 3. 创建 Webhook
npm run setup
# 将输出的 SIGNING_KEYS 填入 .env
```

### 配置 (config.yaml)

- **单 Webhook 模式（推荐，避免 Alchemy 数量限制）**：在顶层设置 `singleWebhook: true`，整份 config 只创建 **1 个** Alchemy Webhook，服务端按每个 target 的地址/方法/类型做多维度筛查，匹配到的每条 log/tx/trace 按对应 target 的 label 分别发 Telegram。只需把该 Webhook 的 Signing Key 填入 `.env` 的 `SIGNING_KEYS`。此时所有 target 共用同一网络（`config.network`）。
- **多 Webhook 模式**：不设 `singleWebhook` 或设为 `false` 时，每个 target 对应一个 Webhook；每个 target 可写 `network`；`npm run setup` 后把每个 webhook 的 Signing Key 填到该 target 的 `signing_key`（推荐）或 `.env` 的 `SIGNING_KEYS`。
- **signing_key per target**（仅多 Webhook 模式）：在 config 中为每个 target 配置 `signing_key`，入站请求用签名区分是哪个监控，避免误报。
- **methodSelectors**：仅当 internal call 的 `input` 以配置的 selector 开头时才发报警。

```yaml
network: eth_mainnet
webhookUrl: https://your-server.com/webhook

targets:
  - type: events
    label: "USDC Transfer"
    addresses: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]
    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]

  - type: internal_calls
    label: "Transfer to USDT (BSC)"
    network: BNB_MAINNET
    addresses: ["0x55d398326f99059fF775485246999027B3197955"]
    toAddresses: ["0x55d398326f99059fF775485246999027B3197955"]
    methodSelectors: ["0xa9059cbb"]   # 仅 input 匹配时报警
```

### Telegram 通知

在 `.env` 中配置：

```
TELEGRAM_BOT_TOKEN=你的Bot Token
TELEGRAM_CHAT_ID=你的Chat ID
```

获取方式：[@BotFather](https://t.me/BotFather) 创建 Bot；发消息给 Bot 后访问 `https://api.telegram.org/bot<token>/getUpdates` 查看 `chat.id`。

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run monitor` | 启动 Webhook 服务 |
| `npm run setup` | 根据 config 创建 Alchemy Webhooks |
| `npm run setup:guide` | 输出手动创建 Webhook 的 GraphQL |
| `npm run poll` | 轮询模式，无需 webhook |
| `npm run test:webhook:local` | 本地带签名测试 |
| `npm run test:tx` | 解析指定交易的 Transfer 参数 |

### 部署

- **阿里云**：见 [DEPLOY-ALIYUN.md](DEPLOY-ALIYUN.md)
- **Railway / Render**：见 [DEPLOY.md](DEPLOY.md)

---

## English

### Features

- **Events**: Monitor contract logs (e.g. ERC20 Transfer)
- **Transactions**: Monitor external transactions to/from addresses
- **Internal Calls**: Monitor `call` / `delegatecall` / `create` with `input` / `output`
- **Telegram**: Optional push notifications

### Requirements

1. [Alchemy](https://www.alchemy.com/) account
2. Publicly accessible webhook URL (tunnel or deployed server)
3. Auth Token: Create at least one webhook in Dashboard first, then AUTH TOKEN appears

### Quick Start

```bash
npm install
cp config.example.yaml config.yaml
cp .env.example .env

# 1. Start server
npm run monitor

# 2. Start tunnel (local dev)
cloudflared tunnel --url http://localhost:8080
# Put https://xxx.trycloudflare.com/webhook into config.yaml

# 3. Create webhooks
npm run setup
# Add SIGNING_KEYS to .env
```

### Config (config.yaml)

- **Single webhook mode** (recommended to stay within Alchemy webhook limits): Set `singleWebhook: true` at the top level. Only **one** Alchemy webhook is created for the whole config; the server matches each incoming log/tx/trace against every target (address, method, type) and sends one Telegram alert per matching target. Put that webhook’s Signing Key in `.env` as `SIGNING_KEYS`. All targets use the same network (`config.network`).
- **Multi-webhook mode**: Omit `singleWebhook` or set it to `false`; each target gets its own webhook. Use per-target `signing_key` or `.env` `SIGNING_KEYS` to validate requests.

```yaml
network: BNB_MAINNET   # or eth_mainnet, polygon_mainnet, etc.
webhookUrl: https://your-server.com/webhook
# singleWebhook: true   # one webhook for all targets, server does filtering

targets:
  - type: events
    label: "USDC Transfer"
    addresses: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]
    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]

  - type: internal_calls
    label: "Transfer to USDT"
    addresses: ["0x55d398326f99059fF775485246999027B3197955"]
    toAddresses: ["0x55d398326f99059fF775485246999027B3197955"]
    methodSelectors: ["0xa9059cbb"]   # transfer(address,uint256)
```

### Telegram Notifications

Add to `.env`:

```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

Create bot via [@BotFather](https://t.me/BotFather); get chat_id from `https://api.telegram.org/bot<token>/getUpdates` after messaging the bot.

### Commands

| Command | Description |
|---------|-------------|
| `npm run monitor` | Start webhook server |
| `npm run setup` | Create Alchemy webhooks from config |
| `npm run setup:guide` | Print GraphQL for manual webhook creation |
| `npm run poll` | Polling mode (no webhook) |
| `npm run test:webhook:local` | Local signed webhook test |

### Deployment

- **Aliyun**: See [DEPLOY-ALIYUN.md](DEPLOY-ALIYUN.md)
- **Railway / Render**: See [DEPLOY.md](DEPLOY.md)

---

## Project Structure

```
monitor/
├── config.yaml          # Your config (gitignored)
├── config.example.yaml  # Config template
├── src/
│   ├── index.ts         # Entry
│   ├── server.ts        # Webhook server
│   ├── handlers.ts      # Event handler + Telegram
│   ├── telegram.ts      # Telegram API
│   ├── config.ts        # Config loader
│   ├── graphql.ts       # GraphQL query builder
│   ├── alchemy-api.ts   # Alchemy Notify API
│   ├── webhook-util.ts  # Signature validation
│   ├── setup.ts         # Webhook creation
│   ├── poll.ts          # Polling mode
│   ├── transfer-parser.ts
│   └── test-tx.ts
├── scripts/
│   ├── test-webhook-signed.ts
│   ├── test-webhook.sh
│   └── setup-webhook-guide.ts
├── DEPLOY-ALIYUN.md
├── DEPLOY.md
└── SETUP-WEBHOOK.md
```

## Troubleshooting

- **401 Invalid signature**: Add correct `SIGNING_KEYS` to `.env` and restart. For testing, use `SKIP_SIGNATURE_VALIDATION=true`.
- **Alchemy cannot reach webhook**: Deploy to a public server (Aliyun, Railway, etc.) instead of local tunnel.
- **fromList.map is not a function**: Fix YAML format — use `- "0x..."` (space after `-`), not `-["0x..."]`.

## References

- [Alchemy Notify API Quickstart](https://www.alchemy.com/docs/reference/notify-api-quickstart)
- [Custom Webhook Filters (callTracerTraces)](https://docs.alchemy.com/reference/custom-webhook-filters)
