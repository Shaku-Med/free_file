#!/bin/bash

# Script to run all application services simultaneously in Cursor's integrated terminal
# This script runs npm install + npm run dev for each service

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting all services..."
echo ""

# Function to run a service with labeled output
run_service() {
    local name=$1
    local dir=$2
    local color=$3
    
    (
        cd "$dir" || exit 1
        echo "[$name] 📦 Installing dependencies..."
        npm install
        echo "[$name] 🚀 Starting dev server..."
        npm run dev
    ) 2>&1 | while IFS= read -r line; do
        echo "[$color$name\033[0m] $line"
    done
}

# Start Redis server in background
echo "🔴 Starting Redis server..."
cd "$SCRIPT_DIR" && redis-server &
REDIS_PID=$!
sleep 2

# Start App service in background with labeled output
echo "🟢 Starting App service..."
APP_DIR="$SCRIPT_DIR/app"
(
    cd "$APP_DIR" || exit 1
    echo "[App] 📦 Installing dependencies..."
    npm install
    echo "[App] 🚀 Starting dev server..."
    npm run dev
) 2>&1 | sed 's/^/[App] /' &
APP_PID=$!

# Start NodeServer in background with labeled output
NODESERVER_DIR="$SCRIPT_DIR/NodeServer"
if [ ! -d "$NODESERVER_DIR" ]; then
    NODESERVER_DIR="$SCRIPT_DIR/LoadNodeServer"
fi

if [ -d "$NODESERVER_DIR" ]; then
    echo "🔵 Starting NodeServer service..."
    (
        cd "$NODESERVER_DIR" || exit 1
        echo "[NodeServer] 📦 Installing dependencies..."
        npm install
        echo "[NodeServer] 🚀 Starting dev server..."
        npm run dev
    ) 2>&1 | sed 's/^/[NodeServer] /' &
    NODESERVER_PID=$!
else
    echo "❌ Error: NodeServer directory not found"
    NODESERVER_PID=""
fi

echo ""
echo "✨ All services are running!"
echo ""
echo "Output from all services will appear below with labels:"
echo "  [App] - App service output"
echo "  [NodeServer] - NodeServer output"
echo "  [Redis] - Redis server (running in background)"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Trap to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping all services..."
    kill $REDIS_PID $APP_PID $NODESERVER_PID 2>/dev/null
    pkill -f "redis-server" 2>/dev/null
    exit
}

trap cleanup INT TERM

# Wait for all background processes
wait
