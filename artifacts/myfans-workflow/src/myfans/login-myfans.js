const { runManualLogin } = require("./login-runner");

async function main() {
  await runManualLogin();
}

main().catch((error) => {
  console.error(`[myfans:login] ${error.message}`);
  process.exitCode = 1;
});
