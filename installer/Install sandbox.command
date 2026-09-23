#!/bin/bash
# Double-click on a Mac. Downloads and runs the installer.
cd "$(dirname "$0")"
curl -fsSL "https://raw.githubusercontent.com/${DEV_SANDBOX_REPO:-FilipChalupa/dev-sandbox}/main/installer/install.sh" | bash
echo
read -r -p "Press Enter to close this window."
