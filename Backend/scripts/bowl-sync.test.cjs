const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isBowlPurchasable,
  targetBowlInventoryQuantity,
} = require("../dist/services/bowlInventoryPolicy.js");
const { serialIsMintedInBitmap } = require("../dist/services/sui/mintState.js");

test("an on-chain mint always makes a bowl unavailable", () => {
  assert.equal(isBowlPurchasable(true, true), false);
  assert.equal(isBowlPurchasable(false, true), false);
});

test("an unminted bowl still requires positive tracked Shopify inventory", () => {
  assert.equal(isBowlPurchasable(true, false), true);
  assert.equal(isBowlPurchasable(false, false), false);
});

test("reconciliation zeroes minted bowls and caps unminted stock at one", () => {
  assert.equal(targetBowlInventoryQuantity(10, true), 0);
  assert.equal(targetBowlInventoryQuantity(10, false), 1);
  assert.equal(targetBowlInventoryQuantity(1, false), 1);
});

test("reconciliation never reopens zero-stock unminted bowls", () => {
  assert.equal(targetBowlInventoryQuantity(0, false), 0);
});

test("MintCap bitmap checks use one-based bowl serials", () => {
  const bitmap = (1n << 0n) | (1n << 20n) | (1n << 48n);
  assert.equal(serialIsMintedInBitmap(bitmap, 1), true);
  assert.equal(serialIsMintedInBitmap(bitmap, 21), true);
  assert.equal(serialIsMintedInBitmap(bitmap, 49), true);
  assert.equal(serialIsMintedInBitmap(bitmap, 31), false);
});
