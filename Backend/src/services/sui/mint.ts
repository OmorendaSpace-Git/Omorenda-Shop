import { config } from "../../config/config";
import { getSuiClient } from "./client";
import { getSponsorKeypair, getSponsorAddress } from "./keypair";

export type MintBowlInput = {
  serial: number;
  name: string;
  imageUrl: string;
  weightGrams: number;
  heightMm: number;
  widthMm: number;
  note: string;
  frequency: string;
  recipient: string;
};

export type MintBowlResult = {
  suiObjectId: string;
  mintTxDigest: string;
  sponsorAddress: string;
};

export class BowlAlreadyMintedError extends Error {
  constructor(serial: number) {
    super(`Bowl #${serial} is already minted in the configured Sui collection. Reconcile the existing certificate and owner before retrying; a duplicate certificate cannot be issued.`);
    this.name = "BowlAlreadyMintedError";
  }
}

function bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

/**
 * Calls `singing_bowl::mint(...)` with the sponsor as sender + gas owner +
 * signer. The recipient receives a fresh `SingingBowl` NFT object.
 *
 * Returns the new object id and tx digest. Throws on chain failure.
 */
export async function mintBowlOnSui(input: MintBowlInput): Promise<MintBowlResult> {
  if (!config.sui.packageId) throw new Error("Missing SUI_PACKAGE_ID");
  if (!config.sui.mintCapObjectId) throw new Error("Missing SUI_MINT_CAP_OBJECT_ID");

  const [client, keypair, sponsor, { Transaction }] = await Promise.all([
    getSuiClient(),
    getSponsorKeypair(),
    getSponsorAddress(),
    import("@mysten/sui/transactions"),
  ]);

  // A reset local database does not reset the serials already minted on-chain.
  const cap = await client.getObject({
    id: config.sui.mintCapObjectId,
    options: { showContent: true },
  });
  const content = cap.data?.content;
  if (content?.dataType !== "moveObject" || !("minted_bitmap" in content.fields)) {
    throw new Error("Could not read the configured MintCap bitmap");
  }
  const bitmap = BigInt(String(content.fields.minted_bitmap));
  if ((bitmap & (1n << BigInt(input.serial - 1))) !== 0n) {
    throw new BowlAlreadyMintedError(input.serial);
  }

  const tx = new Transaction();
  tx.setSender(sponsor);
  tx.setGasOwner(sponsor);

  tx.moveCall({
    target: `${config.sui.packageId}::singing_bowl::mint`,
    arguments: [
      tx.object(config.sui.mintCapObjectId),
      tx.pure.u16(input.serial),
      tx.pure.vector("u8", bytes(input.name)),
      tx.pure.vector("u8", bytes(input.imageUrl)),
      tx.pure.u32(input.weightGrams),
      tx.pure.u32(input.heightMm),
      tx.pure.u32(input.widthMm),
      tx.pure.vector("u8", bytes(input.note)),
      tx.pure.vector("u8", bytes(input.frequency)),
      tx.pure.address(input.recipient),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });

  if (result.effects?.status?.status !== "success") {
    throw new Error(
      `Sui mint tx failed: ${result.effects?.status?.error ?? "unknown error"}`,
    );
  }

  type ObjectChange = { type: string; objectType?: string; objectId?: string };
  const created = (result.objectChanges ?? []).find(
    (c: ObjectChange) =>
      c.type === "created" &&
      typeof c.objectType === "string" &&
      c.objectType.endsWith("::singing_bowl::SingingBowl"),
  ) as ObjectChange | undefined;
  const suiObjectId = created?.objectId;
  if (!suiObjectId) {
    throw new Error("Sui mint tx succeeded but no SingingBowl object change found");
  }

  return { suiObjectId, mintTxDigest: result.digest, sponsorAddress: sponsor };
}
