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

## 6. Nginx 反向代理 + HTTPS

```bash
# 安装 Nginx
apt install -y nginx   # 或 yum install -y nginx

# 安装 certbot（Let's Encrypt）
apt install -y certbot python3-certbot-nginx
```

创建 Nginx 配置 `/etc/nginx/sites-available/monitor`（或 `/etc/nginx/conf.d/monitor.conf`）：

```nginx
server {
    listen 80;
    server_name 你的域名.com;   # 或直接用服务器公网 IP

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
# 启用配置
ln -s /etc/nginx/sites-available/monitor /etc/nginx/sites-enabled/
nginx -t

# 若有域名，申请 HTTPS
certbot --nginx -d 你的域名.com

# 重启 Nginx
systemctl reload nginx
```

## 7. 防火墙

```bash
# 阿里云控制台：安全组放行 80、443
# 或命令行
ufw allow 80
ufw allow 443
ufw reload
```

## 8. Alchemy 配置

- **有域名**：Webhook URL 填 `https://你的域名.com/webhook`
- **无域名**：填 `http://服务器公网IP/webhook`（Alchemy 通常要求 HTTPS，建议用域名 + certbot）

> 若服务器在**国内地域**且 Alchemy 仍无法访问，可考虑将实例迁至**香港/新加坡**地域。

## 9. 验证

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
