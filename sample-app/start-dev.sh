#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use Homebrew Java 17 if system java is missing or non-functional
if ! java -version &>/dev/null; then
  BREW_JAVA="$(brew --prefix openjdk@17 2>/dev/null)/bin"
  if [ -d "$BREW_JAVA" ]; then
    export JAVA_HOME="$(brew --prefix openjdk@17)"
    export PATH="$JAVA_HOME/bin:$PATH"
  else
    echo "Error: Java 17 not found. Install with: brew install openjdk@17" >&2
    exit 1
  fi
fi

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

# Start backend
echo "Starting backend..."
cd "$SCRIPT_DIR/backend"
./mvnw -q spring-boot:run &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend..."
cd "$SCRIPT_DIR/frontend"
npm install --silent && npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend PID:  $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Press Ctrl+C to stop both servers."
echo ""

wait
