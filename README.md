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
# 单 Webhook / 多组：将输出的 Signing Key 填回 config 对应位置；仅「单文件」模式可用 .env 的 SIGNING_KEYS 兜底
```

### 多份 YAML（不同项目方）

同一进程可加载多个配置文件，便于按客户/项目拆分规则：

```bash
# .env
CONFIG_PATHS=./config.predict-fun.yaml,./config.other.yaml
```

- 分隔符支持 **逗号、分号、换行**。
- 未设置 `CONFIG_PATHS` 时，仍使用 **`CONFIG_PATH`**（单文件）或默认 **`config.yaml`**。
- **Alchemy**：每个项目方通常各自建 Webhook，Signing Key 不同；服务端根据 `x-alchemy-signature` **匹配到对应 yaml**，只执行那份配置里的规则。
- **`.env` 的 `SIGNING_KEYS`**：仅在**只加载 1 个 yaml** 时作为签名校验兜底；**多文件模式下不会用 env 兜底**，避免签名校验通过却路由错项目。多文件时请把 key 写在各 yaml 的 `signing_key` / `targets.signing_key` 中。
- **`npm run poll`**：会合并所有 yaml 的 `targets` 轮询（要求 **同一 `network`**）。
- **`npm run setup` / `npm run setup:guide`**：对**每个** yaml 分别创建/打印 Webhook 与 GraphQL。

### 配置 (config.yaml)

`targets` 有三种写法，对应三种模式：

| 模式 | targets 写法 | 说明 |
|------|--------------|------|
| **单 Webhook** | `targets: { signing_key, list: [ ... ] }` + `singleWebhook: true` | 只建 1 个 Webhook，一个 key，多条规则；服务端按规则匹配，用对应 label 报警。Signing Key 填到 `targets.signing_key`。 |
| **多组** | `targets: [ { signing_key, list: [ ... ] }, ... ]` | 每个 key 对应一组规则；收到 event 先按 signing_key 分流到组，再在该组内按规则匹配报警。每组一个 Webhook，setup 后按顺序填各组的 `signing_key`。 |
| **多 Webhook** | `targets: [ { type, label, signing_key?, ... }, ... ]` | 每个 target 一个 Webhook；按 target 的 `signing_key` 或 `.env` 的 `SIGNING_KEYS` 校验。 |

- **methodSelectors**（internal_calls）：仅当 internal call 的 `input` 以配置的 selector 开头时才发报警。
- 示例配置：见 [config.safe-timelock-test.yaml](config.safe-timelock-test.yaml)（Safe → Timelock schedule/execute 等）。
- **Open Eden TBILL**（主网角色/配置/升级，不含用户存取）：[config.tbill.ethereum.yaml](config.tbill.ethereum.yaml)、[config.tbill.arbitrum.yaml](config.tbill.arbitrum.yaml)（ETH 与 Arb 各一链、各一 Webhook；可同时 `CONFIG_PATHS=./config.tbill.ethereum.yaml,./config.tbill.arbitrum.yaml` 跑同一 monitor）。

**单 Webhook 示例：**

```yaml
network: bsc_mainnet
webhookUrl: https://your-server.com/webhook
singleWebhook: true

targets:
  signing_key: ""   # npm run setup 后填
  list:
    - type: internal_calls
      label: "Safe → Timelock"
      fromAddresses: ["0x8d38..."]
      toAddresses: ["0x2e28..."]
      methodSelectors: ["0x56055f7d", "0x134008d3"]
```

**多组示例（每个 signing_key 对应多条规则）：**

```yaml
targets:
  - signing_key: ""
    list:
      - type: internal_calls
        label: "规则1"
        ...
  - signing_key: ""
    list:
      - type: events
        label: "规则2"
        ...
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
| `npm run setup:guide` | 按当前加载的配置输出 GraphQL（多文件时每个 yaml 一段） |
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
# Single / multi-group: fill Signing Key(s) into config; `.env` SIGNING_KEYS fallback only when a **single** yaml is loaded
```

### Multiple YAML files (per tenant / project)

```bash
CONFIG_PATHS=./config.predict-fun.yaml,./config.other.yaml
```

- Separators: comma, semicolon, or newline. If unset, use `CONFIG_PATH` or default `config.yaml`.
- Each Alchemy webhook has its own signing key; the server **routes by signature** to the matching config. Do not rely on `.env` `SIGNING_KEYS` when multiple configs are loaded (keys must live in YAML).
- `npm run poll` merges all targets (same `network` required).
- `npm run setup` / `setup:guide` run once per file.

### Config (config.yaml)

Three `targets` shapes:

| Mode | targets shape | Behavior |
|------|----------------|----------|
| **Single webhook** | `targets: { signing_key, list: [ ... ] }` + `singleWebhook: true` | One webhook, one key, multiple rules; server matches and alerts per rule label. Put Signing Key in `targets.signing_key`. |
| **Multi-group** | `targets: [ { signing_key, list: [ ... ] }, ... ]` | Each key = one group of rules; request is routed by signing_key, then matched against that group only. One webhook per group; fill each group’s `signing_key` after setup. |
| **Multi-webhook** | `targets: [ { type, label, signing_key?, ... }, ... ]` | One webhook per target; validate by per-target `signing_key` or `.env` `SIGNING_KEYS`. |

Example config: [config.safe-timelock-test.yaml](config.safe-timelock-test.yaml) (Safe → Timelock schedule/execute).

```yaml
network: BNB_MAINNET
webhookUrl: https://your-server.com/webhook
singleWebhook: true

targets:
  signing_key: ""
  list:
    - type: internal_calls
      label: "Safe → Timelock"
      fromAddresses: ["0x8d38..."]
      toAddresses: ["0x2e28..."]
      methodSelectors: ["0x56055f7d", "0x134008d3"]
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
| `npm run setup:guide` | Print GraphQL per loaded config file |
| `npm run poll` | Polling mode (no webhook) |
| `npm run test:webhook:local` | Local signed webhook test |

### Deployment

- **Aliyun**: See [DEPLOY-ALIYUN.md](DEPLOY-ALIYUN.md)
- **Railway / Render**: See [DEPLOY.md](DEPLOY.md)

---

## Project Structure

```
monitor/
├── config.yaml                    # Your config (gitignored)
├── config.example.yaml            # Config template
├── config.tbill.ethereum.yaml   # TBILL: ETH — admin / oracle / KYC (no user flows)
├── config.tbill.arbitrum.yaml   # TBILL: Arbitrum — same rule set, different addresses
├── config.predict-fun.yaml      # Example: full project rules (optional split per tenant)
├── config.safe-timelock-test.yaml # Example: Safe → Timelock schedule/execute
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

- **401 Invalid signature**: Ensure the request’s Signing Key matches the yaml that owns that Webhook (`signing_key` / group). With a **single** config file you may also set `.env` `SIGNING_KEYS`. With **`CONFIG_PATHS` (multiple files)**, keys must be in YAML — env list is not used for routing. For local testing: `SKIP_SIGNATURE_VALIDATION=true`.
- **Alchemy cannot reach webhook**: Deploy to a public server (Aliyun, Railway, etc.) instead of local tunnel.
- **fromList.map is not a function**: Fix YAML format — use `- "0x..."` (space after `-`), not `-["0x..."]`.
- **GraphQL 地址数量少于 yaml / Fewer addresses in GraphQL**: 合并查询会对地址与 topic **去重**；细粒度条件（`rules`、`methodSelectors`）仅在服务端生效，不会写进 GraphQL。Merged queries **dedupe** addresses/topics; rules and selectors are server-side only.

## References

- [Alchemy Notify API Quickstart](https://www.alchemy.com/docs/reference/notify-api-quickstart)
- [Custom Webhook Filters (callTracerTraces)](https://docs.alchemy.com/reference/custom-webhook-filters)
