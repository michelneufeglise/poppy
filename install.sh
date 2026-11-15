#!/bin/bash
# Polly's installer for macOS.
#
# Gets Poppy (the app; Polly is its female character) ready to run from source: checks the Mac, gets
# git and Node when they're missing (always asks first), downloads Poppy, installs its packages, builds
# it, and starts it with the setup guide. The guide (a window with Polly) then checks Ollama, a model,
# her voice and her tools, and asks before installing any of those.
#
# Run it from a clone:   ./install.sh
# or straight from GitHub (Homebrew-style, so it can still ask you things):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/michelneufeglise/poppy/main/install.sh)"
#
# POPPY_DIR picks where a fresh copy goes (default ~/poppy). Nothing here needs sudo.
set -euo pipefail

REPO="https://github.com/michelneufeglise/poppy.git"
MIN_NODE=20
MIN_MACOS=12

bold=$'\033[1m'
dim=$'\033[2m'
off=$'\033[0m'
[ -t 1 ] || { bold=""; dim=""; off=""; }

polly() { printf '\n  %sPolly:%s %s\n' "$bold" "$off" "$1"; }
note() { printf '  %s%s%s\n' "$dim" "$1" "$off"; }
fail() {
  polly "$1"
  exit 1
}
ask() {
  local answer
  read -r -p "  $1 [y/N] " answer </dev/tty || return 1
  [[ "$answer" =~ ^[Yy] ]]
}

# Her own drawing, in terminals that can show pictures (iTerm2, WezTerm). Elsewhere, just words.
picture() {
  local file="$1"
  [ -f "$file" ] || return 0
  case "${TERM_PROGRAM:-}" in
    iTerm.app | WezTerm)
      printf '\n\033]1337;File=inline=1;height=8;preserveAspectRatio=1:%s\a\n' "$(base64 <"$file" | tr -d '\n')"
      ;;
  esac
}

brew_bin() {
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && { echo "$b"; return 0; }
  done
  return 1
}

# ---------- the Mac ----------

[ "$(uname)" = "Darwin" ] || fail "I only live on a Mac, sorry!"
macos="$(sw_vers -productVersion)"
[ "${macos%%.*}" -ge "$MIN_MACOS" ] || fail "I need macOS $MIN_MACOS or newer (this Mac has $macos)."
chip="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "a Mac")"
mem=$(($(sysctl -n hw.memsize) / 1073741824))
polly "Hi! I'm Polly. Let's get me onto your $chip ($mem GB, macOS $macos)."
note "I'll ask before I install anything."

# ---------- git (Apple's command line tools) ----------

if ! xcode-select -p >/dev/null 2>&1; then
  polly "I need Apple's command line tools (they have git, and the Swift compiler for my ears)."
  if ask "May I open Apple's installer?"; then
    xcode-select --install || true
    polly "Click Install in Apple's window. I'll wait here…"
    until xcode-select -p >/dev/null 2>&1; do sleep 5; done
  else
    fail "Okay! Run me again once you have them."
  fi
fi

# ---------- where Poppy lives ----------

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/package.json" ] && grep -q '"name": "poppy"' "$here/package.json"; then
  dir="$here"
else
  dir="${POPPY_DIR:-$HOME/poppy}"
  if [ -d "$dir/.git" ]; then
    polly "I'm already in $dir. Getting the newest me…"
    git -C "$dir" pull --ff-only
  else
    [ -e "$dir" ] && fail "$dir already exists and isn't me. Set POPPY_DIR to another folder."
    ask "May I download Poppy (with me in it) into $dir?" || fail "Okay, maybe later!"
    git clone --depth 1 "$REPO" "$dir"
  fi
fi
cd "$dir"
picture "assets/female/states/hello.png"

# ---------- Node ----------

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt "$MIN_NODE" ]; then
  have="$(command -v node >/dev/null 2>&1 && node -v || echo "no Node")"
  polly "I'm built with Node, and I need version $MIN_NODE or newer (you have $have)."
  if brew="$(brew_bin)"; then
    if ask "May I install Node with Homebrew?"; then
      "$brew" install node
      export PATH="$(dirname "$brew"):$PATH"
    else
      fail "Okay! Get Node from https://nodejs.org and run me again."
    fi
  else
    note "Homebrew isn't here, so I'll open the Node download page."
    ask "Open https://nodejs.org/en/download ?" && open "https://nodejs.org/en/download"
    fail "Run me again once Node is installed."
  fi
fi
note "Node $(node -v), npm $(npm -v)"

# ---------- packages and build ----------

picture "assets/female/states/busy.png"
polly "Installing my packages (exact versions from package-lock.json)…"
npm ci --no-fund --no-audit
polly "Putting myself together…"
npm run build

# ---------- start ----------

picture "assets/female/states/clapping.png"
polly "Done! I'm starting now. My setup guide opens and checks Ollama, a model, my voice and my tools."
note "Start me again later with:  cd \"$dir\" && npx electron ."
note "Run the setup guide again:  menu-bar icon → Setup check…  (or: npm run setup)"
nohup npx electron . --setup >/dev/null 2>&1 &
