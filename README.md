# Alchemy 链上监控

基于 [Alchemy Notify API](https://docs.alchemy.com/docs/alchemy-notify) 的链上事件与**内部调用**监控项目。支持：

- **Events**：监控指定合约发出的事件（logs）
- **Transactions**：监控发往/来自指定地址的外部交易
- **Internal Calls**：监控内部调用（`call` / `delegatecall` / `create`），使用 Alchemy Custom Webhook 的 `callTracerTraces` 过滤器

## 前置要求

1. [Alchemy](https://www.alchemy.com/) 账号
2. **本地 Webhook 服务 + 隧道**：必须先启动 `npm run monitor` 和隧道（如 cloudflared），Alchemy 才能成功配置并投递 Webhook
3. **Auth Token**：需先在 Dashboard 手动创建至少一个 Webhook 后，才能在 Webhooks 页面看到 AUTH TOKEN 按钮

### ⚠️ ngrok 免费版不适用于 Webhook

ngrok 免费版会对请求显示「Visit Site」插页，Alchemy 的 webhook 请求会被拦截，无法到达你的服务。建议使用以下替代方案：

| 方案 | 命令 | 说明 |
|------|------|------|
| **Cloudflare Tunnel** | `cloudflared tunnel --url http://localhost:8080` | 免费，无插页 |
| **localtunnel** | `npx localtunnel --port 8080` | 免费，`npx` 即可用 |
| **ngrok 付费版** | `ngrok http 8080` | 自定义域名无插页 |

## 快速开始

**正确顺序**：先启动本地 Webhook 服务 + 隧道，再在 Alchemy 配置；否则 Alchemy 无法验证你的接收地址。

```bash
# 1. 安装依赖
npm install
cp config.example.yaml config.yaml
cp .env.example .env

# 2. 先启动本地 Webhook 服务（必须最先运行）
npm run monitor

# 3. 另开终端，启动隧道
cloudflared tunnel --url http://localhost:8080
# 将输出的 https://xxx.trycloudflare.com 加上 /webhook 填入 config.yaml 的 webhookUrl

# 4. 本地服务 + 隧道就绪后，才能在 Alchemy Dashboard 创建 Webhook
#    Data → Webhooks → Create Webhook → 选择 Custom → 填入 webhookUrl、GraphQL 等
#    创建成功后，在 Webhooks 页面右上角点击 AUTH TOKEN，复制到 .env 的 ALCHEMY_AUTH_TOKEN

# 5. 之后可用 API 批量创建（可选）
npm run setup

# 6. 将 setup 输出的 SIGNING_KEYS 填入 .env
```

## 配置说明

### config.yaml

```yaml
network: eth_mainnet          # 网络
webhookUrl: https://xxx.ngrok.io/webhook   # 接收地址

targets:
  # 监控合约事件
  - type: events
    label: "USDC Transfer"
    addresses: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]
    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]

  # 监控外部交易
  - type: transactions
    label: "Calls to Vault"
    addresses: ["0x388C818CA8B9251b393131C08a736A67ccB19297"]
    txTo: ["0x388C818CA8B9251b393131C08a736A67ccB19297"]

  # 监控内部调用（含合约 A 调用合约 B）
  - type: internal_calls
    label: "Internal calls to Router"
    addresses: ["0x5c43B1eD97e52d009611D89b74fA829FE4ac56b1"]
    toAddresses: ["0x5c43B1eD97e52d009611D89b74fA829FE4ac56b1"]
    # fromAddresses: []   # 空表示任意 from
```

### 支持的网络

`eth_mainnet`, `eth_sepolia`, `polygon_mainnet`, `arbitrum_mainnet`, `optimism_mainnet`, `base_mainnet` 等。

### Internal Calls 说明

`internal_calls` 使用 Alchemy Custom Webhook 的 **callTracerTraces**（BETA），可捕获：

- 合约 A 调用合约 B 的 `call` / `delegatecall`
- 合约创建 `create`
- 调用链中的 `from`、`to`、`value`、`input`、`output`、`gasUsed` 等

注意：部分链可能尚未支持 callTracerTraces，请查阅 [Alchemy 文档](https://docs.alchemy.com/reference/custom-webhook-filters#internal-transaction-debug-trace-calls-filters-beta)。

## 自定义事件处理

默认将事件格式化输出到控制台。可在 `src/index.ts` 中替换 `onEvent` 回调：

```ts
import { createServer, startServer } from "./server.js";

const app = createServer({
  port: PORT,
  host: HOST,
  signingKeys,
  onEvent: async (event) => {
    // 写入数据库、发送告警、推送到消息队列等
    await yourHandler(event);
  },
});
```

## 轮询模式（无需 Webhook）

无需隧道、公网地址或 Alchemy Webhook，直接通过 RPC 轮询 `eth_getLogs`：

```bash
npm run poll
```

支持环境变量：`RPC_URL`、`BSC_RPC_URL`、`POLL_INTERVAL`（默认 12 秒）

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run poll` | 轮询模式，无需 webhook |
| `npm run setup` | 根据 config.yaml 创建 Alchemy Webhooks |
| `npm run monitor` | 启动 Webhook 接收服务 |
| `npm run dev` | 开发模式（热重载） |

## 项目结构

```
monitor/
├── config.yaml          # 监控配置（需自行创建）
├── config.example.yaml  # 配置示例
├── src/
│   ├── index.ts         # 入口
│   ├── setup.ts         # Webhook 创建脚本
│   ├── config.ts        # 配置加载
│   ├── graphql.ts       # GraphQL 查询构建
│   ├── alchemy-api.ts   # Alchemy Notify API
│   ├── server.ts        # Webhook 服务器
│   ├── webhook-util.ts  # 签名验证
│   └── handlers.ts      # 默认事件处理
└── package.json
```

## 故障排查

**Webhook 投递失败？** 若使用 ngrok 免费版，Alchemy 请求会被 ngrok 插页拦截。请改用 Cloudflare Tunnel 或 localtunnel：

```bash
# 方案 A: Cloudflare Tunnel（需先安装 cloudflared）
cloudflared tunnel --url http://localhost:8080

# 方案 B: localtunnel（无需安装）
npx localtunnel --port 8080
```

将输出的 URL（如 `https://xxx.loca.lt`）加上 `/webhook` 填入 config.yaml 的 webhookUrl。

**Alchemy 测试显示 Internal Server Error？**
1. 若尚未配置 `SIGNING_KEYS`，在 `.env` 中临时添加 `SKIP_SIGNATURE_VALIDATION=true` 后重启服务
2. 查看终端日志，确认是否有 `[Webhook] Handler error` 或 `Invalid signature` 等报错
3. 确认隧道和本地服务均在运行，且 webhookUrl 包含 `/webhook` 路径

## Webhook 配置清单

按 [Alchemy Notify API Quickstart](https://www.alchemy.com/docs/reference/notify-api-quickstart) 要求，需满足：

| 项 | 说明 | 本项目 |
|----|------|--------|
| **Webhook URL** | 公网可访问的 HTTPS 地址，路径为 `/webhook` | `config.yaml` → `webhookUrl` |
| **200 响应** | 成功接收后必须返回 200 | ✅ 已实现 |
| **签名验证** | 校验 `X-Alchemy-Signature`（HMAC SHA-256） | ✅ 已实现，需 `SIGNING_KEYS` |
| **Signing Key** | 每个 webhook 的签名密钥 | Dashboard → Webhook 详情页 或 `npm run setup` 输出 |
| **Auth Token** | 用于 create-webhook 等 API | 需先手动创建至少一个 Webhook 后，Dashboard → Webhooks 右上角出现 |
| **IP 白名单**（可选） | 仅接受来自 Alchemy 的请求 | `54.236.136.17`、`34.237.24.169`（可在防火墙/Nginx 中配置） |

## 参考

- [Alchemy Notify API Quickstart](https://www.alchemy.com/docs/reference/notify-api-quickstart)
- [Alchemy Custom Webhooks](https://docs.alchemy.com/reference/custom-webhook)
- [Custom Webhook Filters (含 callTracerTraces)](https://docs.alchemy.com/reference/custom-webhook-filters)
