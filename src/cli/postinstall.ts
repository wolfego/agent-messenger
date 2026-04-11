#!/usr/bin/env node

import { execSync } from "node:child_process";
import { platform } from "node:os";

function checkPath(): void {
  if (platform() !== "win32") return;

  let npmPrefix = "";
  try {
    npmPrefix = execSync("npm prefix -g", {
      encoding: "utf-8",
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch {
    return;
  }

  let userPath = "";
  try {
    userPath = execSync(
      'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"',
      { encoding: "utf-8", timeout: 5_000, windowsHide: true }
    ).trim();
  } catch {
    return;
  }

  const inPath = userPath.split(";").some((p) => p.replace(/[\\/]+$/, "") === npmPrefix.replace(/[\\/]+$/, ""));

  if (!inPath) {
    console.log(`
  ⚠  agent-messenger: npm global bin is not in your PATH.

     Run in PowerShell (one time):

     [Environment]::SetEnvironmentVariable("PATH", [Environment]::GetEnvironmentVariable("PATH","User") + ";${npmPrefix}", "User")

     Then restart your terminal.
`);
  } else {
    console.log(`
  ✓  agent-messenger installed. If 'agent-messenger' isn't recognized,
     restart your terminal to pick up the updated PATH.
`);
  }
}

checkPath();
