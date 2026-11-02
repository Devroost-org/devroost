#!/usr/bin/env sh
set -eu

REPO="${DEVROOST_REPO:-Devroost-org/devroost}"
VERSION="${DEVROOST_VERSION:-latest}"
INSTALL_DIR="${DEVROOST_INSTALL_DIR:-$HOME/.local/bin}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_command node
require_command podman
require_command tar
require_command install

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [ -z "$node_major" ] || [ "$node_major" -lt 24 ]; then
  echo "Node.js 24+ is required. Current version: $(node -v 2>/dev/null || echo unknown)"
  exit 1
fi

if ! podman info >/dev/null 2>&1; then
  echo "Warning: Podman is installed but not currently reachable."
  echo "Run 'devroost start' after installation; Devroost will auto-start Podman Machine on macOS/Windows."
fi

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *)
    echo "Unsupported OS: $uname_s"
    exit 1
    ;;
esac

case "$uname_m" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *)
    echo "Unsupported architecture: $uname_m"
    exit 1
    ;;
esac

asset="devroost-${os}-${arch}.tar.gz"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

tmp_dir="$(mktemp -d)"
staged_stacks=""
cleanup() {
  rm -rf "$tmp_dir"
  if [ -n "$staged_stacks" ] && [ -d "$staged_stacks" ]; then
    rm -rf "$staged_stacks"
  fi
}
trap cleanup EXIT

mkdir -p "$INSTALL_DIR"

echo "Downloading $url"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp_dir/devroost.tar.gz"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp_dir/devroost.tar.gz" "$url"
else
  echo "curl or wget is required"
  exit 1
fi

tar -xzf "$tmp_dir/devroost.tar.gz" -C "$tmp_dir"
if [ ! -d "$tmp_dir/stacks" ]; then
  echo "Release archive is missing required stack assets" >&2
  exit 1
fi

staged_stacks="$(mktemp -d "$INSTALL_DIR/.devroost-stacks-new.XXXXXX")"
cp -R "$tmp_dir/stacks/." "$staged_stacks/"
install -m 0755 "$tmp_dir/devroost" "$INSTALL_DIR/devroost"
install -m 0644 "$tmp_dir/devroost.mjs" "$INSTALL_DIR/devroost.mjs"
rm -rf "$INSTALL_DIR/stacks"
mv "$staged_stacks" "$INSTALL_DIR/stacks"
staged_stacks=""
rm -rf "$INSTALL_DIR/examples"

echo "Installed Devroost to $INSTALL_DIR/devroost"
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ;;
  *)
    echo "Add $INSTALL_DIR to PATH to use devroost globally"
    ;;
esac
