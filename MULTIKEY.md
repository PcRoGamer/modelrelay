# ModelRelay Multi-API Key Support

Fork of [ellipticmarketing/modelrelay](https://github.com/ellipticmarketing/modelrelay) with multi-API key rotation and load balancing.

---

## Features Added

- ✅ **Multi-key rotation** - Use multiple API keys per provider
- ✅ **Load balancing** - Distribute requests across keys
- ✅ **Auto-fallback** - Retry with different key on rate limit
- ✅ **Rate limit tracking** - Per-key usage tracking
- ✅ **Backward compatible** - Existing configs still work
- ✅ **Stats endpoint** - Monitor key performance

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /key-rotation-stats` | Get key usage statistics |

```bash
# Example
curl http://localhost:7352/key-rotation-stats
```

---

## New Config Format

```json
{
  "apiKeys": {
    "groq": "gsk_xxx"
  },
  "apiKeysV2": {
    "groq": {
      "keys": [
        {"key": "gsk_xxx", "weight": 50, "priority": 1, "limit": 1000},
        {"key": "gsk_yyy", "weight": 50, "priority": 2, "limit": 1000}
      ],
      "rotation": "round-robin",
      "fallback": true
    }
  }
}
```

---

## Rotation Strategies

| Strategy | Description |
|----------|-------------|
| `round-robin` | Cycle through keys in order (default) |
| `weighted` | Random selection based on weight |
| `priority` | Use lowest priority number first |
| `random` | Pure random selection |

---

## Key Options

```json
{
  "key": "gsk_xxx",
  "weight": 50,           // For weighted rotation (default: 1)
  "priority": 1,          // Lower = higher priority (default: 1)
  "limit": 1000,          // Max requests per window
  "limitWindow": "day"    // Window: minute, hour, day, month
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `lib/keyRotation.js` | ➕ NEW - Core rotation logic |
| `lib/config.js` | 📝 Updated - Added apiKeysV2 docs |
| `lib/server.js` | 🔧 Modified - Integrated rotation |

---

## Usage

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Edit config:**
   ```bash
   nano ~/.modelrelay.json
   ```

3. **Add multi-key section:**
   ```json
   {
     "apiKeysV2": {
       "groq": {
         "keys": [
           {"key": "gsk_key1", "weight": 50},
           {"key": "gsk_key2", "weight": 50}
         ],
         "rotation": "round-robin"
       }
     }
   }
   ```

4. **Run:**
   ```bash
   npm start
   ```

---

## Testing

```bash
# Test single provider with multiple keys
curl http://localhost:7352/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto-fastest",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Check key stats
curl http://localhost:7352/key-rotation-stats
```

---

## How It Works

1. Request comes in → router picks best model
2. Provider selected → check for `apiKeysV2` config
3. Has multi-key? → Use `KeyRotationManager` to get next key
4. Request fails (429/401)? → Mark key as failed, retry with next key
5. Request succeeds? → Mark key as success, update stats

---

## Cooldown Behavior

- After rate limit (429), key enters cooldown (default: 60s)
- After max failures, key is excluded until cooldown expires
- Usage limits reset per window (minute/hour/day/month)

---

## Migration from Single Key

Existing `apiKeys` config still works. To migrate:

```bash
# Old format (still works)
"apiKeys": { "groq": "gsk_xxx" }

# New format (multi-key)
"apiKeysV2": {
  "groq": {
    "keys": [{"key": "gsk_xxx"}],
    "rotation": "round-robin"
  }
}
```