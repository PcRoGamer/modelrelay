#!/bin/bash
cd ~/.openclaw/workspace/modelrelay
node bin/modelrelay.js > /tmp/modelrelay.log 2>&1 &
echo "Started with PID: $!"
