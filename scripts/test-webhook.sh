#!/bin/bash
# 测试 webhook 是否可达
# 用法: ./scripts/test-webhook.sh [webhook_url]
# 或从 config.yaml 读取 webhookUrl

set -e
URL="${1:-}"
if [ -z "$URL" ]; then
  if command -v yq &>/dev/null; then
    URL=$(yq '.webhookUrl' config.yaml 2>/dev/null)
  else
    URL=$(grep -E '^webhookUrl:' config.yaml | sed 's/webhookUrl: *//' | tr -d ' "')
  fi
fi
if [ -z "$URL" ]; then
  echo "用法: $0 <webhook_url>"
  echo "或设置 config.yaml 中的 webhookUrl"
  exit 1
fi
echo "测试: $URL"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Alchemy-Signature: test" \
  -d '{"id":"test-'$(date +%s)'","event":{}}')
echo "HTTP $HTTP"
[ "$HTTP" = "200" ] && echo "✅ 通过" || echo "❌ 失败"
