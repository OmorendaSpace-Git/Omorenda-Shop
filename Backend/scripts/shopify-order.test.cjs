const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'test-token';
const { createShopifyOrder } = require('../dist/services/shopify/admin');
const session = `cs_test_${'A'.repeat(58)}`;
const args = {
  shop: 'example.myshopify.com', currency: 'USD', sourceIdentifier: session,
  lineItems: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1, unitPrice: '100.00' }],
};
const response = data => ({ ok: true, status: 200, json: async () => ({ data }) });

test('checkout sends valid order tags and preserves the full session reference', async t => {
  const searches = [];
  let sentOrder;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    const { query, variables } = JSON.parse(request.body);
    if (query.includes('query findOrder')) {
      searches.push(variables.query);
      return response({ orders: { nodes: [] } });
    }
    sentOrder = variables.order;
    const invalid = sentOrder.tags.some(tag => tag.length > 40 || !/^[a-z0-9-]+$/i.test(tag));
    return response({ orderCreate: {
      userErrors: invalid ? [{ field: ['order', 'tags'], message: 'Order Order tags is invalid' }] : [],
      order: invalid ? null : { id: 'gid://shopify/Order/1' },
    } });
  });
  assert.equal(await createShopifyOrder(args), 'gid://shopify/Order/1');
  assert.equal(sentOrder.sourceIdentifier, session);
  assert.equal(sentOrder.tags.length, 2);
  assert.ok(searches[0].includes(sentOrder.tags[1]));
});

test('repeat checkout can recover an existing order using its legacy tag', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    calls++;
    const { query, variables } = JSON.parse(request.body);
    assert.ok(query.includes('query findOrder'));
    assert.ok(variables.query.includes(`stripe-session-${session}`));
    return response({ orders: { nodes: [{ id: 'gid://shopify/Order/legacy' }] } });
  });
  assert.equal(await createShopifyOrder(args), 'gid://shopify/Order/legacy');
  assert.equal(calls, 1, 'existing order must not be created again');
});

test('order recovery after an error uses the same short tag as creation', async t => {
  let queries = 0;
  let createdTag;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    const { query, variables } = JSON.parse(request.body);
    if (query.includes('query findOrder')) {
      queries++;
      if (queries === 1) return response({ orders: { nodes: [] } });
      assert.ok(variables.query.includes(createdTag));
      return response({ orders: { nodes: [{ id: 'gid://shopify/Order/recovered' }] } });
    }
    createdTag = variables.order.tags[1];
    return response({ orderCreate: { userErrors: [{ message: 'Ambiguous order response' }], order: null } });
  });
  assert.equal(await createShopifyOrder(args), 'gid://shopify/Order/recovered');
  assert.ok(createdTag.length <= 40);
  assert.equal(queries, 2);
});
