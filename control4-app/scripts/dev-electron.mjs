// Launch Electron for local dev with a clean environment.
//
// We cannot just call `electron .` from this shell because VS Code's extension
// host sets ELECTRON_RUN_AS_NODE=1, which forces Electron to behave as a plain
// Node interpreter and skip the main-process bootstrap. Deleting the var
// before spawning restores normal app launch.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

const env = { ...process.env, NODE_ENV: "development" };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("close", (code) => process.exit(code ?? 0));
