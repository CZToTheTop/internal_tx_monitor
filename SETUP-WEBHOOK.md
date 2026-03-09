# Alchemy Webhook 配置步骤

## 1. 启动服务（两个终端）

```bash
# 终端 1
npm run monitor

# 终端 2
cloudflared tunnel --url http://localhost:8080
```

## 2. 更新 config.yaml

将隧道输出的 URL（如 `https://xxx.trycloudflare.com`）加上 `/webhook` 填入：

```yaml
webhookUrl: https://xxx.trycloudflare.com/webhook
```

## 3. 获取 GraphQL 配置

```bash
npm run setup:guide
```

按输出内容在 Alchemy Dashboard 中填写。

## 4. 在 Alchemy 创建 Webhook

1. 打开 https://dashboard.alchemy.com/
2. 选择 App → **Data** → **Webhooks** → **Create Webhook**
3. 选择 **Custom**
4. 填写：
   - **Network**: BNB_MAINNET（BSC）
   - **Webhook URL**: 你的 `webhookUrl`
   - **GraphQL Query**: 从 `npm run setup:guide` 输出复制
5. 点击 **Create Webhook**

## 5. 配置 .env

创建 Webhook 后，在详情页复制 **Signing Key**，填入 `.env`：

```
SIGNING_KEYS=whsec_你的key
```

## 6. 测试

- 在 Alchemy 点击 **Test Webhook**
- 或运行 `npm run test:webhook`

## 监控内部调用

如需监控内部调用（call/delegatecall 参数），在 config.yaml 添加：

```yaml
targets:
  - type: internal_calls
    label: "Internal calls to LISTA"
    addresses: ["0xfceb31a79f71ac9cbdcf853519c1b12d379edc46"]
    toAddresses: ["0xfceb31a79f71ac9cbdcf853519c1b12d379edc46"]
```

然后运行 `npm run setup:guide` 获取新的 GraphQL，在 Dashboard 再创建一个 Webhook。
