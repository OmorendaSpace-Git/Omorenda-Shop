const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../dist/config/db");
const { hideOrderFromHistory, listOrders } = require("../dist/controllers/orderController");

const user = { id: "11111111-1111-4111-8111-111111111111", email: "buyer@example.com" };
const orderId = "22222222-2222-4222-8222-222222222222";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function stubOrderMethod(t, method, replacement) {
  const delegate = prisma.order;
  const original = delegate[method];
  delegate[method] = replacement;
  t.after(() => { delegate[method] = original; });
}

test("purchase history lists only visible orders owned by the customer", async (t) => {
  stubOrderMethod(t, "findMany", async (args) => {
    assert.equal(args.where.hiddenAt, null);
    assert.deepEqual(args.where.OR, [{ userId: user.id }, { userId: null, email: user.email }]);
    return [];
  });
  const res = response();
  await listOrders({ user }, res);
  assert.deepEqual(res.body, { orders: [] });
});

test("removing history hides only an order owned by the customer", async (t) => {
  stubOrderMethod(t, "updateMany", async (args) => {
    assert.equal(args.where.id, orderId);
    assert.equal(args.where.hiddenAt, null);
    assert.deepEqual(args.where.OR, [{ userId: user.id }, { userId: null, email: user.email }]);
    assert.ok(args.data.hiddenAt instanceof Date);
    return { count: 1 };
  });
  const res = response();
  await hideOrderFromHistory({ user, params: { id: orderId } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { hidden: true });
});

test("another customer's order cannot be removed from history", async (t) => {
  stubOrderMethod(t, "updateMany", async () => ({ count: 0 }));
  const res = response();
  await hideOrderFromHistory({ user, params: { id: orderId } }, res);
  assert.equal(res.statusCode, 404);
});
