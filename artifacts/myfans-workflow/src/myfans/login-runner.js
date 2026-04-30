const { mkdir } = require("node:fs/promises");
const { stdin, stdout } = require("node:process");
const readline = require("node:readline/promises");
const { chromium } = require("playwright");
const { MANUAL_INSTRUCTIONS, resolveLoginConfig } = require("./login-config");

function createDefaultWaitForEnter() {
  return async function waitForEnter() {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      await rl.question("");
    } finally {
      rl.close();
    }
  };
}

async function runManualLogin(options = {}) {
  const chromiumLib = options.chromiumLib || chromium;
  const env = options.env || process.env;
  const log = options.log || console.log;
  const waitForEnter = options.waitForEnter || createDefaultWaitForEnter();
  const { profileDir, generatorUrl } = resolveLoginConfig(env);

  await mkdir(profileDir, { recursive: true });
  const context = await chromiumLib.launchPersistentContext(profileDir, { headless: false });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(generatorUrl, { waitUntil: "domcontentloaded" });

    for (const line of MANUAL_INSTRUCTIONS) {
      log(line);
    }

    await waitForEnter();
  } finally {
    await context.close();
  }
}

module.exports = {
  createDefaultWaitForEnter,
  runManualLogin,
};
