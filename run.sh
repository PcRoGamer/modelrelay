#!/bin/bash
cd ~/.openclaw/workspace/modelrelay
node bin/modelrelay.js 2>&1 &
echo $! > server.pid
echo "Server started with PID: $(cat server.pid)"
echo "Waiting 8 seconds..."
sleep 8
echo "Testing..."
curl -s http://localhost:7352/api/meta | head -c 100
echo ""
echo "Server log:"
tail -20 /tmp/mr.log 2>/dev/null || echo "No log yet"