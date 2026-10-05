import { API_BASE_URL, fetchJson } from "./client";
import type { AuthUser } from "./auth";
import { storeUser } from "./auth";

const SESSION_KEY = "zklogin_pending_v1";

const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) ?? "";

const SUI_NETWORK: "testnet" | "mainnet" | "devnet" =
  ((import.meta.env.VITE_SUI_NETWORK as string | undefined) as
    | "testnet"
    | "mainnet"
    | "devnet") || "testnet";

const SUI_RPC_URL: string =
  (import.meta.env.VITE_SUI_RPC_URL as string | undefined) ||
  `https://sui-${SUI_NETWORK}-rpc.publicnode.com`;

type PendingState = {
  ephemeralSecretKey: string; // base64
  ephemeralPublicKey: string; // base64
  maxEpoch: number;
  randomness: string;
  nonce: string;
  returnTo: string;
};

function savePending(state: PendingState) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

export function readPending(): PendingState | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingState;
  } catch {
    return null;
  }
}

export function clearPending() {
  sessionStorage.removeItem(SESSION_KEY);
}

/**
 * Kicks off the Google + zkLogin sign-in. Generates an ephemeral Sui
 * keypair, computes the zkLogin nonce, stashes the secrets in
 * sessionStorage, and redirects to Google's OAuth implicit flow with
 * response_type=id_token.
 */
export async function startGoogleZkLogin(returnTo: string = "/") {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Missing VITE_GOOGLE_OAUTH_CLIENT_ID");
  }

  const [{ Ed25519Keypair }, { SuiJsonRpcClient }, zk] = await Promise.all([
    import("@mysten/sui/keypairs/ed25519"),
    import("@mysten/sui/jsonRpc"),
    import("@mysten/sui/zklogin"),
  ]);

  const ephemeralKeypair = Ed25519Keypair.generate();

  const client = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
  const { epoch } = await client.getLatestSuiSystemState();
  const maxEpoch = Number(epoch) + 2;

  const randomness = zk.generateRandomness();
  const nonce = zk.generateNonce(
    ephemeralKeypair.getPublicKey(),
    maxEpoch,
    randomness,
  );

  const secretKey = ephemeralKeypair.getSecretKey();
  const publicKey = ephemeralKeypair.getPublicKey().toBase64();

  savePending({
    ephemeralSecretKey: secretKey,
    ephemeralPublicKey: publicKey,
    maxEpoch,
    randomness,
    nonce,
    returnTo,
  });

  const redirectUri = `${window.location.origin}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    prompt: "select_account",
    nonce,
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Called from the /auth/google/callback page after Google redirects back.
 * Exchanges the Google ID token for our app session.
 */
export async function completeGoogleZkLogin(
  idToken: string,
): Promise<{ user: AuthUser; suiAddress: string | null }> {
  const pending = readPending();
  const expectedNonce = pending?.nonce ?? undefined;

  const result = await fetchJson<{ user: AuthUser; suiAddress: string | null }>(
    `${API_BASE_URL}/auth/google/zklogin`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, expectedNonce }),
    },
  );

  storeUser(result.user);
  clearPending();
  return result;
}
