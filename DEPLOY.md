# 海外部署方案（解决 Alchemy 无法访问国内 Webhook）

Alchemy 的 webhook 服务器在美国，从国内隧道（Cloudflare/ngrok）可能无法稳定访问。建议将服务部署到海外云平台。

## 方案 1：Railway（推荐，简单）

1. 注册 https://railway.app/
2. New Project → Deploy from GitHub（或 Deploy from Repo）
3. 设置环境变量：
   - `SIGNING_KEYS` = 你的 whsec_xxx（**仅单文件 config** 时作签名校验兜底；多项目请用 `CONFIG_PATHS` 并把 key 写在各 yaml）
   - 可选 `CONFIG_PATH` / `CONFIG_PATHS`：见根目录 README「多份 YAML」
   - `PORT` = 8080（Railway 会自动注入，可不设）
4. 部署后 Railway 会分配 `https://xxx.up.railway.app`
5. 在 Alchemy 创建 Webhook 时，Webhook URL 填：`https://xxx.up.railway.app/webhook`

## 方案 2：Render

1. 注册 https://render.com/
2. New → Web Service → 连接 GitHub
3. 配置：
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - 添加环境变量 `SIGNING_KEYS`
4. 部署后得到 `https://xxx.onrender.com/webhook`

## 方案 3：Vercel（Serverless）

需将 Express 适配为 serverless。可添加 `api/webhook.ts` 作为 Vercel Function。

## 方案 4：自有 VPS（香港/新加坡/美国）

```bash
# 服务器上
git clone <your-repo>
cd monitor
npm install
npm run build
# 使用 pm2 或 systemd 常驻运行
PORT=8080 SIGNING_KEYS=whsec_xxx node dist/index.js
# 多 yaml：CONFIG_PATHS=./a.yaml,./b.yaml（key 写在 yaml 内，可不设 SIGNING_KEYS）
```

用 Nginx 反向代理并配置 HTTPS（Let's Encrypt）。

---

## 部署流程（首次）

1. **先部署**（可暂不设 SIGNING_KEYS，先加 `SKIP_SIGNATURE_VALIDATION=true` 用于测试）
2. **拿到公网 URL**（如 `https://xxx.up.railway.app`）
3. **在 Alchemy 创建 Webhook**，URL 填 `https://xxx.up.railway.app/webhook`
4. **复制 Signing Key**，在 Railway/Render 中添加环境变量 `SIGNING_KEYS=whsec_xxx`
5. **移除** `SKIP_SIGNATURE_VALIDATION`，重新部署
