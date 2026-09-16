import test from "node:test";
import assert from "node:assert/strict";
import { addResource, applyFailureLoss, createRng, generateForest } from "../src/core.js";

test("rng is deterministic", () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test("addResource respects inventory capacity", () => {
  const inventory = { wood: 19, stone: 0, fiber: 0, apple: 0 };
  const added = addResource(inventory, "stone", 4, 20);
  assert.equal(added, 1);
  assert.equal(inventory.stone, 1);
});

test("applyFailureLoss removes half of expedition gains", () => {
  const inventory = { wood: 10, stone: 8, fiber: 4, apple: 2 };
  const gains = { wood: 5, stone: 3, fiber: 0, apple: 1 };
  const losses = applyFailureLoss(inventory, gains, 0.5);
  assert.deepEqual(losses, { wood: 3, stone: 2, apple: 1 });
  assert.deepEqual(inventory, { wood: 7, stone: 6, fiber: 4, apple: 1 });
});

test("forest generation is deterministic for same seed", () => {
  const a = generateForest(1111);
  const b = generateForest(1111);
  assert.deepEqual(a, b);
});
