#!/usr/bin/env bash
set -e
classroom_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
nvm use 24
cd "$classroom_root"
npm run db:start
npm run dev
