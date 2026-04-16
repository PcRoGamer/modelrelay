#!/bin/bash
echo "=== Uninstalling global modelrelay ==="
npm uninstall -g modelrelay 2>&1 || echo "Not installed globally"

echo "=== Creating symlink ==="
ln -sf ~/.openclaw/workspace/modelrelay/bin/modelrelay.js ~/.local/bin/modelrelay

echo "=== Testing ==="
which modelrelay
ls -la $(which modelrelay)
echo "Done!"