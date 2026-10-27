export function isBowlPurchasable(
  shopifyAvailable: boolean,
  mintedOnChain: boolean,
): boolean {
  return shopifyAvailable && !mintedOnChain;
}

/**
 * Singing bowls are one-of-one inventory.
 *
 * - an on-chain mint is final, so stock must be zero;
 * - positive Shopify quantities are capped at one;
 * - zero stock stays zero so reconciliation never reopens a legitimately
 *   sold bowl whose mint still needs manual recovery.
 */
export function targetBowlInventoryQuantity(
  currentQuantity: number,
  mintedOnChain: boolean,
): number {
  if (mintedOnChain) return 0;
  return currentQuantity > 0 ? 1 : 0;
}

export function targetBowlInventoryQuantities(
  currentQuantities: number[],
  mintedOnChain: boolean,
  preferredIndex = -1,
): number[] {
  if (mintedOnChain) return currentQuantities.map(() => 0);
  const keeperIndex =
    preferredIndex >= 0 && currentQuantities[preferredIndex] > 0
      ? preferredIndex
      : currentQuantities.findIndex(quantity => quantity > 0);
  return currentQuantities.map((_quantity, index) => (index === keeperIndex ? 1 : 0));
}
