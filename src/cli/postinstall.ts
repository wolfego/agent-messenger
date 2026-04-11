#!/usr/bin/env node

import { execSync } from "node:child_process";
import { platform } from "node:os";

function checkPath(): void {
  if (platform() !== "win32") return;

  try {
    execSync("agent-messenger --help", {
      stdio: "ignore",
      timeout: 5_000,
      windowsHide: true,
    });
  } catch {
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

    console.log(`
  ⚠  agent-messenger installed, but may not be in your PATH.

     To fix, run in PowerShell:

     [Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";${npmPrefix}", "User")

     Then restart your terminal.
`);
  }
}

checkPath();
