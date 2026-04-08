# Security Audit

## Summary

Security review of the Alchemy chain monitor project. Key findings and mitigations below.

---

## Fixed Issues

### 1. Signature Timing Attack (Medium)

**Issue**: Signature comparison used `===`, vulnerable to timing attacks. An attacker could potentially brute-force the signature byte-by-byte by measuring response times.

**Fix**: Use `crypto.timingSafeEqual()` for constant-time comparison in `webhook-util.ts`.

### 2. Telegram HTML Injection (Low)

**Issue**: Webhook payload data (block hash, tx hash, addresses) was interpolated into Telegram HTML without escaping. Malicious payload could inject HTML/script.

**Fix**: Added `escapeHtml()` and hex sanitization for dynamic content in `handlers.ts`.

### 3. CONFIG_PATH / CONFIG_PATHS Path Traversal (Low)

**Issue**: `CONFIG_PATH` or each path in `CONFIG_PATHS` could resolve outside the project directory (e.g. `../../../etc/passwd`), allowing arbitrary file read.

**Fix**: Validate every resolved path stays under `process.cwd()` in `config.ts` (`loadConfig` per file).

---

## Recommendations

### SKIP_SIGNATURE_VALIDATION

**Risk**: When `SKIP_SIGNATURE_VALIDATION=true`, any request is accepted without signature check. **Never use in production.**

- Document clearly in `.env.example`
- Consider warning on startup when enabled

### Rate Limiting

**Risk**: `/webhook` has no rate limit. If URL is leaked, attacker could spam requests.

**Mitigation**: Add rate limiting (e.g. `express-rate-limit`) or rely on reverse proxy (Nginx, Cloudflare).

### Body Size (10mb)

**Risk**: 10mb limit is large; very large payloads could cause memory pressure.

**Mitigation**: Consider reducing to 1–2mb; typical Alchemy payloads are much smaller.

### Secrets in Logs

- `setup.ts` logs `Signing Key: xxx...` (first 12 chars) — acceptable for setup
- Ensure `DEBUG_SIGNATURE` (if re-added) never logs full keys or signatures

---

## Secure Practices

| Area | Status |
|------|--------|
| Signature validation | ✅ HMAC-SHA256, constant-time compare |
| Error messages | ✅ Generic "Internal error", no stack trace |
| Secrets | ✅ From env, not logged |
| HTTPS | ⚠️ App is HTTP; use Nginx/TLS in production |
| Input validation | ✅ Config path validated, hex sanitized for TG |

---

## Reporting Vulnerabilities

Please report security issues privately before public disclosure.
