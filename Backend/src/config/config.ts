import dotenv from "dotenv";

dotenv.config();

const ENV = process.env.NODE_ENV ?? process.env.ENV ?? "development";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";
const COOKIE_SAME_SITE = (process.env.AUTH_COOKIE_SAME_SITE ?? "lax") as "lax" | "strict" | "none";

function commaSeparated(value: string | undefined, fallback: string[]): string[] {
  const values = (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
  return values.length > 0 ? values : fallback;
}

const SUI_NETWORK = (process.env.SUI_NETWORK ?? "testnet") as
  | "testnet"
  | "mainnet"
  | "devnet"
  | "localnet";

const DEFAULT_SUI_RPC: Record<string, string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
  localnet: "http://127.0.0.1:9000",
};

export const config = {
  env: ENV,
  port: Number(process.env.PORT) || 8001,
  databaseUrl: process.env.DATABASE_URL ?? "",
  frontendUrl: FRONTEND_URL,
  frontendOrigins: commaSeparated(process.env.FRONTEND_URLS, [FRONTEND_URL]),
  auth: {
    accessTokenSecret: process.env.AUTH_ACCESS_TOKEN_SECRET ?? process.env.AUTH_JWT_SECRET ?? "",
    refreshTokenSecret: process.env.AUTH_REFRESH_TOKEN_SECRET ?? process.env.AUTH_JWT_SECRET ?? "",
    issuer: "omorenda-api",
    audience: "omorenda-shop",
    cookieSameSite: COOKIE_SAME_SITE,
    accessTokenMaxAgeSec: Number(process.env.AUTH_ACCESS_TOKEN_MAX_AGE_SEC ?? "3600") || 3600,
    refreshTokenMaxAgeSec: Number(process.env.AUTH_REFRESH_TOKEN_MAX_AGE_SEC ?? String(60 * 60 * 24 * 30)) || (60 * 60 * 24 * 30),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },
  shopify: {
    shop: process.env.SHOPIFY_SHOP ?? "",
    apiVersion: process.env.SHOPIFY_API_VERSION ?? "2024-01",
    storefrontPrivateToken: process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN ?? "",
    adminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "",
    locationId: process.env.SHOPIFY_LOCATION_ID ?? "",
    bowlTag: process.env.SHOPIFY_BOWL_TAG ?? "singing-bowl",
  },
  sui: {
    network: SUI_NETWORK,
    rpcUrl: process.env.SUI_RPC_URL || DEFAULT_SUI_RPC[SUI_NETWORK],
    packageId: process.env.SUI_PACKAGE_ID ?? "",
    mintCapObjectId: process.env.SUI_MINT_CAP_OBJECT_ID ?? "",
    sponsorPrivateKey: process.env.SUI_SPONSOR_PRIVATE_KEY ?? "",
    explorerObjectBase:
      process.env.SUI_EXPLORER_OBJECT_BASE ?? `https://suiscan.xyz/${SUI_NETWORK}/object`,
  },
  mintWorker: {
    pollIntervalMs: Number(process.env.MINT_WORKER_POLL_INTERVAL_MS) || 2000,
    maxAttempts: Number(process.env.MINT_WORKER_MAX_ATTEMPTS) || 5,
  },
  google: {
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    zkLoginProverUrl:
      process.env.ZKLOGIN_PROVER_URL ?? "https://prover-dev.mystenlabs.com/v1",
    zkLoginSaltEncryptionKey: process.env.ZKLOGIN_SALT_ENCRYPTION_KEY ?? "",
  },
};

export function validateConfig() {
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.auth.accessTokenSecret) missing.push("AUTH_ACCESS_TOKEN_SECRET");
  if (!config.auth.refreshTokenSecret) missing.push("AUTH_REFRESH_TOKEN_SECRET");

  if (config.env === "production") {
    if (config.auth.accessTokenSecret.length < 32) missing.push("AUTH_ACCESS_TOKEN_SECRET (32+ chars)");
    if (config.auth.refreshTokenSecret.length < 32) missing.push("AUTH_REFRESH_TOKEN_SECRET (32+ chars)");
    if (config.auth.accessTokenSecret === config.auth.refreshTokenSecret) {
      missing.push("distinct access and refresh token secrets");
    }
    if (!["lax", "strict", "none"].includes(config.auth.cookieSameSite)) missing.push("valid AUTH_COOKIE_SAME_SITE");
    if (!config.stripe.secretKey) missing.push("STRIPE_SECRET_KEY");
    if (!config.stripe.webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
    if (!config.shopify.shop) missing.push("SHOPIFY_SHOP");
    if (!config.shopify.adminAccessToken) missing.push("SHOPIFY_ADMIN_ACCESS_TOKEN");
    if (!config.google.oauthClientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
    if (!config.google.zkLoginSaltEncryptionKey) missing.push("ZKLOGIN_SALT_ENCRYPTION_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`Invalid server configuration: ${missing.join(", ")}`);
  }
}

