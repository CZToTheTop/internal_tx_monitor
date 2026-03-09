#!/bin/bash
# 本机测试 webhook（绕过代理）
# 用法: ./scripts/test-webhook-local.sh [port]

PORT="${1:-8080}"
URL="http://127.0.0.1:${PORT}"

echo "测试 $URL"
echo ""

echo "=== /health ==="
curl -s --noproxy '*' "$URL/health"
echo -e "\n"

echo "=== /webhook (需 SIGNING_KEY 或 SKIP_SIGNATURE_VALIDATION=true) ==="
# 无有效签名时可能返回 Invalid signature，属正常
curl -s --noproxy '*' -X POST "$URL/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Alchemy-Signature: test" \
  -d '{"id":"test-123","event":{"data":{"block":{"number":1}}}}'
echo -e "\n"
