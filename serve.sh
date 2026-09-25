#!/usr/bin/env bash
# Serve the app from this laptop at a fixed ngrok address.
#
# One-time setup:
#   1. brew install ngrok
#   2. ngrok config add-authtoken YOUR_TOKEN        (token: https://dashboard.ngrok.com/get-started/your-authtoken)
#   3. Claim your free static domain:              https://dashboard.ngrok.com/domains
#   4. Put that domain on the NGROK_DOMAIN line below.
#
# Every game night:
#   ./serve.sh
# Then open https://<your domain> on the iPad. Ctrl-C stops everything.

NGROK_DOMAIN="your-name.ngrok-free.app"
PORT=8000

cd "$(dirname "$0")" || exit 1

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed. Run: brew install ngrok"; exit 1
fi
if [ "$NGROK_DOMAIN" = "your-name.ngrok-free.app" ]; then
  echo "Edit serve.sh and set NGROK_DOMAIN to the static domain from https://dashboard.ngrok.com/domains"; exit 1
fi

# Local web server for the files in this folder (Macs ship with python3).
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT

echo
echo "  iPad / anywhere:  https://$NGROK_DOMAIN"
echo "  this laptop:      http://localhost:$PORT"
echo
ngrok http "$PORT" --url="https://$NGROK_DOMAIN"
