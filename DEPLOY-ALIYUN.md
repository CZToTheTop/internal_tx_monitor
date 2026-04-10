# 阿里云服务器部署 Webhook

## 1. 服务器准备

```bash
# SSH 登录
ssh root@你的服务器IP

# 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs   # 或 yum install -y nodejs

# 验证
node -v   # v20.x
npm -v
```

## 2. 部署代码

```bash
# 方式 A：Git 拉取
cd /opt
git clone <你的仓库地址> monitor
cd monitor

# 方式 B：本地上传
# 本地执行: scp -r ./monitor root@服务器IP:/opt/
```

## 3. 安装依赖并构建

```bash
cd /opt/monitor
npm install
npm run build
```

## 4. 配置环境变量

```bash
# 创建 .env
cat > .env << 'EOF'
SIGNING_KEYS=whsec_你的key
# 多项目多 yaml：CONFIG_PATHS=config.a.yaml,config.b.yaml（Signing Key 写在各 yaml）
PORT=8080
HOST=0.0.0.0
EOF

# 或先设 SKIP_SIGNATURE_VALIDATION=true 测试，拿到 Signing Key 后再改
```

## 5. 使用 PM2 常驻运行

```bash
# 安装 pm2
npm install -g pm2

# 启动
cd /opt/monitor
pm2 start dist/index.js --name alchemy-monitor

# 开机自启
pm2 save
pm2 startup
```

## 6. Nginx 反向代理（无域名用 80 端口即可）

```bash
apt install -y nginx
```

创建 `/etc/nginx/sites-available/monitor` 或 `/etc/nginx/conf.d/monitor.conf`：

```nginx
server {
    listen 80;
    server_name _;

    location /webhook {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }

    location /health {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/monitor /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

**无域名时**：Alchemy 先填 `http://你的公网IP/webhook` 测试。若要求 HTTPS，再按下面步骤用 DuckDNS。

## 7. 防火墙

```bash
# 阿里云控制台：安全组放行 80、443
# 或命令行
ufw allow 80
ufw allow 443
ufw reload
```

## 8. 无域名时：用免费子域名 + HTTPS

Alchemy 通常要求 HTTPS。无域名时可用 **DuckDNS** 免费子域名：

```bash
# 1. 注册 https://www.duckdns.org/，创建子域名如 alchemy-monitor.duckdns.org，指向你的服务器公网 IP

# 2. 安装 certbot 的 DuckDNS 插件
apt install -y certbot
pip3 install certbot-dns-duckdns

# 3. 在 DuckDNS 页面获取 Token，创建配置
mkdir -p /etc/letsencrypt
echo "dns_duckdns_token=你的Token" > /etc/letsencrypt/duckdns.ini
chmod 600 /etc/letsencrypt/duckdns.ini

# 4. 申请证书（替换为你的子域名和邮箱）
certbot certonly \
  --non-interactive \
  --agree-tos \
  --email your@email.com \
  --preferred-challenges dns \
  --authenticator dns-duckdns \
  --dns-duckdns-credentials /etc/letsencrypt/duckdns.ini \
  --dns-duckdns-propagation-seconds 60 \
  -d "alchemy-monitor.duckdns.org"
```

### 5. 修改 Nginx 配置，启用 HTTPS

编辑 `/etc/nginx/sites-available/monitor` 或 `/etc/nginx/conf.d/monitor.conf`，替换为以下内容（将 `alchemy-monitor.duckdns.org` 换成你的子域名）：

```nginx
server {
    listen 80;
    server_name alchemy-monitor.duckdns.org;
    # HTTP 自动跳转到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name alchemy-monitor.duckdns.org;

    # Let's Encrypt 证书路径
    ssl_certificate /etc/letsencrypt/live/alchemy-monitor.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/alchemy-monitor.duckdns.org/privkey.pem;

    # 可选：SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location /webhook {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }

    location /health {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

执行以下命令检查并重载 Nginx：

```bash
nginx -t && systemctl reload nginx
```

**Alchemy Webhook URL**：`https://alchemy-monitor.duckdns.org/webhook`

**或先试 HTTP**：部分场景 Alchemy 可能接受 `http://公网IP:80/webhook`，可在 Dashboard 先填该地址测试。

## 9. Alchemy 配置

- **有域名/子域名**：`https://你的域名/webhook`
- **仅 IP**：`http://公网IP/webhook`（若 Alchemy 报错需 HTTPS，再用 DuckDNS）

## 10. 验证

```bash
# 本地测试
curl -X POST https://你的域名.com/webhook \
  -H "Content-Type: application/json" \
  -H "X-Alchemy-Signature: test" \
  -d '{"id":"test"}'
# 应返回 200 OK
```

## 常用命令

```bash
pm2 logs alchemy-monitor    # 查看日志
pm2 restart alchemy-monitor # 重启
pm2 stop alchemy-monitor    # 停止
```

