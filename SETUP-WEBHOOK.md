# Alchemy Webhook 配置步骤

## 1. 启动服务（两个终端）

```bash
# 终端 1
npm run monitor

# 终端 2
cloudflared tunnel --url http://localhost:8080
```

## 2. 更新配置文件中的 webhookUrl

将隧道输出的 URL（如 `https://xxx.trycloudflare.com`）加上 `/webhook` 填入 **对应 yaml**：

```yaml
webhookUrl: https://xxx.trycloudflare.com/webhook
```

**多份 yaml**（`.env` 里 `CONFIG_PATHS=./a.yaml,./b.yaml`）时，每个项目方可维护自己的文件；**每个文件各自填公网 URL**（可相同或不同，视部署而定）。

## 3. 获取 GraphQL

```bash
npm run setup:guide
```

- **单文件**（默认 `config.yaml` 或 `CONFIG_PATH=...`）：输出一段合并后的 GraphQL，按需复制到 Dashboard。
- **多文件**（`CONFIG_PATHS`）：按**每个 yaml** 分别打印 Network、Webhook URL、GraphQL；在 Alchemy 里为每个项目各建一个 Custom Webhook，避免混用。

## 4. 在 Alchemy 创建 Webhook

1. 打开 https://dashboard.alchemy.com/
2. 选择 App → **Data** → **Webhooks** → **Create Webhook**
3. 选择 **Custom**
4. 填写：
   - **Network**：与 yaml 顶层 `network` 一致（如 BNB_MAINNET）
   - **Webhook URL**：该 yaml 里的 `webhookUrl`
   - **GraphQL Query**：来自上一步、对应该文件的查询
5. 点击 **Create Webhook**

多份 yaml 则对每一份重复上述步骤（或 `npm run setup` 自动按文件创建）。

## 5. 配置 Signing Key

创建 Webhook 后，在详情页复制 **Signing Key**，填回 **该 yaml** 的：

- 单 Webhook 模式：`targets.signing_key`
- 多组模式：每个 `signing_key` 与 `setup` 输出顺序对应

**仅当进程只加载 1 个 yaml 时**，可把 key 写在 `.env`：

```
SIGNING_KEYS=whsec_你的key
```

加载 **多个 yaml** 时不要用 `.env` 代替 yaml 里的 key（服务端按签名路由到对应配置，env 列表不会参与多文件分流）。

## 6. 测试

- 在 Alchemy 点击 **Test Webhook**
- 本地带签名测试：`npm run test:webhook:local`（需 `npm run monitor` 已启动）

## 监控内部调用

在对应 yaml 的 `targets` 中增加 `internal_calls`（`toAddresses` / `methodSelectors` 等），保存后重新执行 `npm run setup:guide`（或 `setup`），用**新的 GraphQL** 更新 Dashboard 里对应 Webhook。
