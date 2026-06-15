#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/home/sjht/apps/WangC"

echo "Starting WangC qrcode backend..."
cd "$BASE_DIR/qrcode-server"
docker compose up -d

echo "Starting WangC qrcode admin..."
cd "$BASE_DIR/qrcode-admin"
docker compose up -d

echo "Current service status:"
cd "$BASE_DIR/qrcode-server"
docker compose ps

cd "$BASE_DIR/qrcode-admin"
docker compose ps

echo "WangC services are ready."
echo "Admin: http://192.168.20.53:3011"
echo "API health: http://192.168.20.53:3010/api/health"
