const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JWT } = require('google-auth-library');

const productId = 'aquadiagnose_premium';
const purchased = () => ({
  purchaseStateContext: { purchaseState: 'PURCHASED' },
  productLineItem: [{ productId, productOfferDetails: { consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' } }],
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING'
});

function backend(t, options = {}) {
  const original = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'test@example.invalid', private_key: 'mock-key' });
  t.after(() => {
    if (original === undefined) delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
    else process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = original;
  });
  const calls = [];
  t.mock.method(JWT.prototype, 'request', async request => {
      calls.push(request);
      if (options.error) throw options.error;
      if (request.method === 'POST' && options.ackError) throw new Error('Acknowledgement unavailable');
      return { data: options.purchase || purchased() };
  });
  delete require.cache[require.resolve('../api/google-play')];
  const handler = require('../api/google-play');
  return {
    calls,
    async run(method = 'POST', body = { productId, purchaseToken: 'test/token' }) {
      const res = { headers: {}, code: 200,
        setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; }
      };
      await handler({ method, body }, res);
      return res;
    }
  };
}

test('readiness checks real product access and disables caching', async t => {
  const b = backend(t);
  const result = await b.run('GET');
  assert.deepEqual(result.body, { ready: true });
  assert.match(b.calls[0].url, /\/applications\/com\.schwarzermarco14\.aquadiagnose2\/oneTimeProducts\/aquadiagnose_premium$/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('unconfigured server blocks all payment processing', async t => {
  const b = backend(t);
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
  assert.equal((await b.run('GET')).code, 503);
  assert.equal((await b.run()).code, 503);
  assert.equal(b.calls.length, 0);
});

test('malformed configuration never leaks credentials', async t => {
  const b = backend(t);
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT = 'secret-invalid-json';
  const result = await b.run('GET');
  assert.equal(result.code, 503);
  assert.ok(!JSON.stringify(result.body).includes('secret-invalid-json'));
});

test('rejects other products, malformed tokens and unsupported methods', async t => {
  const b = backend(t);
  for (const body of [{}, { productId: 'other', purchaseToken: 'x' }, { productId, purchaseToken: ' ' }, { productId, purchaseToken: 42 }, { productId, purchaseToken: 'x'.repeat(4097) }]) {
    assert.equal((await b.run('POST', body)).code, 400);
  }
  const result = await b.run('DELETE');
  assert.equal(result.code, 405);
  assert.equal(result.headers.Allow, 'GET, POST');
  assert.equal(b.calls.length, 0);
});

test('verified new purchase is acknowledged, never consumed', async t => {
  const b = backend(t);
  assert.deepEqual((await b.run()).body, { premium: true });
  assert.equal(b.calls.length, 2);
  assert.match(b.calls[0].url, /\/purchases\/productsv2\/tokens\/test%2Ftoken$/);
  assert.match(b.calls[1].url, /\/purchases\/products\/aquadiagnose_premium\/tokens\/test%2Ftoken:acknowledge$/);
  assert.equal(b.calls[1].method, 'POST');
  assert.ok(b.calls.every(c => !c.url.includes(':consume')));
});

test('already acknowledged purchase can be restored repeatedly', async t => {
  const purchase = purchased();
  purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  const b = backend(t, { purchase });
  assert.deepEqual((await b.run()).body, { premium: true });
  assert.deepEqual((await b.run()).body, { premium: true });
  assert.equal(b.calls.length, 2);
});

for (const state of ['PENDING', 'CANCELLED', 'PURCHASE_STATE_UNSPECIFIED']) {
  test(`does not acknowledge or unlock a ${state} purchase`, async t => {
    const purchase = purchased();
    purchase.purchaseStateContext.purchaseState = state;
    const b = backend(t, { purchase });
    assert.deepEqual((await b.run()).body, { premium: false });
    assert.equal(b.calls.length, 1);
  });
}

test('valid purchase for a different product cannot unlock Premium', async t => {
  const purchase = purchased();
  purchase.productLineItem[0].productId = 'other-product';
  const b = backend(t, { purchase });
  assert.deepEqual((await b.run()).body, { premium: false });
  assert.equal(b.calls.length, 1);
});

test('consumed purchase cannot unlock permanent Premium access', async t => {
  const purchase = purchased();
  purchase.productLineItem[0].productOfferDetails.consumptionState = 'CONSUMPTION_STATE_CONSUMED';
  const b = backend(t, { purchase });
  assert.deepEqual((await b.run()).body, { premium: false });
});

test('fully refunded purchase cannot unlock Premium even if still marked purchased', async t => {
  const purchase = purchased();
  purchase.productLineItem[0].productOfferDetails.refundableQuantity = 0;
  const b = backend(t, { purchase });
  assert.deepEqual((await b.run()).body, { premium: false });
});

test('a rental cannot unlock permanent Premium access', async t => {
  const purchase = purchased();
  purchase.productLineItem[0].productOfferDetails.rentOfferDetails = {};
  const b = backend(t, { purchase });
  assert.deepEqual((await b.run()).body, { premium: false });
});

test('acknowledgement failure never grants an entitlement', async t => {
  const b = backend(t, { ackError: true });
  assert.equal((await b.run()).code, 503);
});

test('Google permission errors do not leak tokens and fail readiness', async t => {
  const b = backend(t, { error: Object.assign(new Error('secret-token'), { response: { status: 403 } }) });
  assert.equal((await b.run('GET')).code, 503);
  const result = await b.run();
  assert.equal(result.code, 503);
  assert.ok(!JSON.stringify(result.body).includes('secret-token'));
});

test('Google rejects an invalid purchase token without granting Premium', async t => {
  const b = backend(t, { error: { response: { status: 404 } } });
  assert.deepEqual((await b.run()).body, { premium: false });
});
