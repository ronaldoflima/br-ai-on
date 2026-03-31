#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ENV_PATH = path.resolve(__dirname, "../.env");
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SERVICE_NAME = "HawkAI";

function base32Encode(buf) {
  let bits = 0, value = 0, output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  return output;
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function keyUri(account, issuer, secret) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function writeEnv(vars) {
  fs.writeFileSync(ENV_PATH, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + " [s/N] ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "s");
    });
  });
}

async function printQr(text) {
  try {
    const qrcodePath = require.resolve("qrcode", { paths: [path.resolve(__dirname, "../dashboard/node_modules")] });
    const qrcode = require(qrcodePath);
    const qr = await qrcode.toString(text, { type: "terminal", small: true });
    console.log(qr);
  } catch {
    console.log("(QR code indisponível — instale dependências em dashboard/ com npm install)\n");
  }
}

async function main() {
  const env = readEnv();

  if (env.TOTP_SECRET) {
    console.log("\n⚠️  TOTP já configurado.");
    const overwrite = await confirm("Deseja gerar um novo secret? (invalidará o QR code atual)");
    if (!overwrite) { console.log("Cancelado."); process.exit(0); }
  }

  const secret = generateSecret();
  const otpauth = keyUri("admin", SERVICE_NAME, secret);

  console.log("\n🔐 HawkAI TOTP Setup\n");
  console.log("Escaneie com Google Authenticator, 1Password ou similar:\n");

  await printQr(otpauth);

  console.log(`Escaneie o QR code acima com o app autenticador.\n`);

  env.TOTP_SECRET = secret;
  writeEnv(env);

  console.log("✅ Secret salvo no .env\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
