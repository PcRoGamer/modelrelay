#!/bin/bash
cd ~/.openclaw/workspace/modelrelay
echo "=== Stopping any running modelrelay ==="
pkill -f modelrelay 2>/dev/null || true
sleep 2

echo "=== Unlinking old modelrelay ==="
npm unlink -g modelrelay 2>/dev/null || true

echo "=== Creating new link ==="
npm link

echo "=== Testing ==="
which modelrelay
echo "Done! Use 'modelrelay' command now."