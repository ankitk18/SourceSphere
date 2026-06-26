#!/usr/bin/env bash
set -euo pipefail

# SourceSphere CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/ankitk18/SourceSphere/main/scripts/install.sh | bash

REPO_URL="https://github.com/ankitk18/SourceSphere.git"
INSTALL_DIR="$HOME/.sourcesphere"
BIN_DIR="$INSTALL_DIR/bin"
WRAPPER="$BIN_DIR/sourcesphere"

# Detect whether this script is being run from inside the SourceSphere repo.
# If so, install from the local source instead of cloning from GitHub.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USE_LOCAL=false
if [ -f "$LOCAL_REPO_DIR/src/cli/index.ts" ] && [ -f "$LOCAL_REPO_DIR/package.json" ]; then
  USE_LOCAL=true
fi

# Colors for output
RESET='\033[0m'
BLUE='\033[34m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'

info() {
  echo -e "${BLUE}info:${RESET} $1"
}

success() {
  echo -e "${GREEN}success:${RESET} $1"
}

warn() {
  echo -e "${YELLOW}warn:${RESET} $1"
}

error() {
  echo -e "${RED}error:${RESET} $1" >&2
}

# Ensure Node.js and npm are available.
if ! command -v node >/dev/null 2>&1; then
  error "Node.js is required but not installed. Please install Node.js first: https://nodejs.org/"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  error "npm is required but not installed."
  exit 1
fi

info "Installing SourceSphere CLI into $INSTALL_DIR..."

# Remove any previous installation first.
if [ -d "$INSTALL_DIR" ]; then
  warn "Existing installation found at $INSTALL_DIR; updating..."
  rm -rf "$INSTALL_DIR"
fi

if [ "$USE_LOCAL" = true ]; then
  info "Installing from local repo at $LOCAL_REPO_DIR..."
  cp -R "$LOCAL_REPO_DIR" "$INSTALL_DIR"
  # Remove local git history from the installed copy.
  rm -rf "$INSTALL_DIR/.git"
else
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1
  else
    # Fallback to downloading a tarball if git is unavailable.
    TMP_DIR=$(mktemp -d)
    curl -fsSL "${REPO_URL%.git}/archive/refs/heads/main.tar.gz" | tar -xz -C "$TMP_DIR" --strip-components=1
    mv "$TMP_DIR" "$INSTALL_DIR"
  fi
fi

info "Installing dependencies (this may take a minute)..."
cd "$INSTALL_DIR"
npm install --silent

# Create the wrapper binary.
mkdir -p "$BIN_DIR"
cat > "$WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/.sourcesphere"
./node_modules/.bin/tsx src/cli/index.ts "$@"
EOF
chmod +x "$WRAPPER"

# Add ~/.sourcesphere/bin to PATH if not already present.
SHELL_RC=""
if [ -n "${ZSH_VERSION:-}" ] || [ "${SHELL##*/}" = "zsh" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -n "${BASH_VERSION:-}" ] || [ "${SHELL##*/}" = "bash" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
  if ! grep -q "$BIN_DIR" "$SHELL_RC"; then
    info "Adding $BIN_DIR to PATH in $SHELL_RC"
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
  fi
fi

# Optionally symlink into /usr/local/bin so it is available system-wide.
if [ -w "/usr/local/bin" ]; then
  ln -sf "$WRAPPER" /usr/local/bin/sourcesphere
  success "SourceSphere is installed. Run 'sourcesphere --help' to get started."
else
  success "SourceSphere is installed."
  warn "Could not write to /usr/local/bin (try running with sudo if you want a global command)."
  info "To use it now, either start a new terminal or run:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
  echo "  sourcesphere --help"
fi
