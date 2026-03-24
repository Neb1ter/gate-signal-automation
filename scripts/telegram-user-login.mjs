import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { config } from "../src/config.mjs";
import { loginTelegramUser } from "../src/telegram.mjs";

async function promptText(rl, label, { allowEmpty = false } = {}) {
  while (true) {
    const answer = String(await rl.question(`${label}: `)).trim();
    if (answer || allowEmpty) {
      return answer;
    }
  }
}

async function main() {
  if (!config.telegram.apiId || !config.telegram.apiHash) {
    throw new Error(
      "Please set TELEGRAM_API_ID and TELEGRAM_API_HASH before logging into your Telegram user account.",
    );
  }

  const rl = readline.createInterface({ input, output });

  try {
    console.log("Telegram personal-account login");
    console.log("This will save a reusable session for long-running monitoring.");

    const result = await loginTelegramUser({
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      userSession: config.telegram.userSession,
      userSessionFile: config.telegram.userSessionFile,
      connectionRetries: config.telegram.connectionRetries,
      phoneNumber: async () =>
        promptText(rl, "Enter your Telegram phone number with country code"),
      phoneCode: async () => promptText(rl, "Enter the Telegram login code"),
      password: async () =>
        promptText(rl, "Enter your 2FA password if enabled, otherwise press Enter", {
          allowEmpty: true,
        }),
      onError: (error) => {
        console.error(`[telegram-login] ${error.message}`);
      },
    });

    console.log("");
    console.log("Login successful.");
    console.log(`Account: ${result.me.displayName}`);
    if (result.me.username) {
      console.log(`Username: @${result.me.username}`);
    }
    console.log(`Session saved to: ${config.telegram.userSessionFile}`);
    console.log("");
    console.log("Use this value for cloud deployment:");
    console.log(`TELEGRAM_USER_SESSION=${result.sessionString}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
