const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const dotenv = require("dotenv");

const backendDir = path.resolve(__dirname, "..");
const envPath = path.join(backendDir, ".env");
const inheritedWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
dotenv.config({ path: envPath, quiet: true });

// Use the same test account as checkout, even when the CLI login differs.
const apiKey = process.env.STRIPE_SECRET_KEY;
if (!apiKey || !/^(sk|rk)_test_/.test(apiKey)) {
  console.error("Local webhook forwarding requires a Stripe test key in STRIPE_SECRET_KEY.");
  process.exit(1);
}

const cli = process.platform === "win32" ? "stripe.exe" : "stripe";
const childEnv = { ...process.env, STRIPE_API_KEY: apiKey };
let signingSecret;
try {
  const output = execFileSync(cli, ["listen", "--print-secret"], {
    cwd: backendDir,
    env: childEnv,
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  signingSecret = output.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (!signingSecret) throw new Error("No signing secret returned");
} catch {
  console.error("Could not obtain the listener secret. Check that Stripe CLI is installed, the test key is valid, and Stripe is reachable.");
  process.exit(1);
}

const source = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const parsed = dotenv.parse(source);
if (parsed.STRIPE_WEBHOOK_SECRET !== signingSecret) {
  const line = `STRIPE_WEBHOOK_SECRET=${signingSecret}`;
  const pattern = /^[ \t]*(?:export\s+)?STRIPE_WEBHOOK_SECRET\s*=.*$/gm;
  const updated = pattern.test(source)
    ? source.replace(pattern, line)
    : `${source}${source.endsWith("\n") || !source ? "" : "\n"}${line}\n`;
  fs.writeFileSync(envPath, updated);
  console.log("Updated Backend/.env with the matching signing secret. Restart the backend to load it.");
} else {
  console.log("Backend/.env already has the matching signing secret.");
}
if (inheritedWebhookSecret && inheritedWebhookSecret !== signingSecret) {
  console.log("If STRIPE_WEBHOOK_SECRET is set in your backend terminal environment, remove that override before restarting.");
}

if (!process.argv.includes("--setup-only")) {
  const port = Number(process.env.PORT) || 8001;
  const url = `http://localhost:${port}/webhooks/stripe`;
  console.log(`Forwarding checkout events from the backend's Stripe test account to ${url}. Keep this terminal open.`);
  const child = spawn(cli, ["listen", "--events", "checkout.session.completed", "--forward-to", url], {
    cwd: backendDir,
    env: childEnv,
    stdio: "inherit",
  });
  child.on("error", () => { console.error("Could not start Stripe CLI."); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 0; });
  process.on("SIGINT", () => child.kill("SIGINT"));
}
