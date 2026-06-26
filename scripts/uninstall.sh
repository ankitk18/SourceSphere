#!/usr/bin/env bash
set -euo pipefail

# SourceSphere CLI uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/ankitk18/SourceSphere/main/scripts/uninstall.sh | bash

INSTALL_DIR="$HOME/.sourcesphere"

# Colors for output
RESET='\033[0m'
BLUE='\033[34m'
GREEN='\033[32m'
YELLOW='\033[33m'

info() {
  echo -e "${BLUE}info:${RESET} $1"
}

success() {
  echo -e "${GREEN}success:${RESET} $1"
}

warn() {
  echo -e "${YELLOW}warn:${RESET} $1"
}

info "Uninstalling SourceSphere CLI..."

# Remove the install directory.
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  info "Removed $INSTALL_DIR"
fi

# Remove system-wide symlink if it exists.
if [ -L "/usr/local/bin/sourcesphere" ]; then
  if [ -w "/usr/local/bin" ]; then
    rm -f "/usr/local/bin/sourcesphere"
    info "Removed /usr/local/bin/sourcesphere"
  else
    warn "Could not remove /usr/local/bin/sourcesphere (run with sudo if you want it removed)"
  fi
fi

# Remove PATH export from shell rc files.
for RC in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [ -f "$RC" ]; then
    if grep -q "\.sourcesphere/bin" "$RC"; then
      # Create a backup and remove the line.
      sed -i.bak '/\.sourcesphere\/bin/d' "$RC"
      rm -f "$RC.bak"
      info "Cleaned up PATH export in $RC"
    fi
  fi
done

success "SourceSphere CLI has been uninstalled."
info "Please open a new terminal for the PATH changes to take effect."
