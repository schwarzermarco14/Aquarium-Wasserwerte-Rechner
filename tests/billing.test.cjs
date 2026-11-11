const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(`${__dirname}/../index.html`, 'utf8');
const source = html.slice(html.indexOf('let isPremiumUser = false;'), html.indexOf('function showUpgradeModal'));
const product = { itemId: 'aquadiagnose_premium', title: 'Premium', price: { currency: 'EUR', value: '4.99' } };

function app(options = {}) {
  const alerts = [], completions = [], requests = [], backendCalls = [];
  const service = {
    listPurchases: async () => options.purchases || [],
    getDetails: async () => options.products || [product]
  };
  const context = vm.createContext({
    alert: message => alerts.push(message), console, AbortSignal,
    renderCalendar() {},
    getDigitalGoodsService: async provider => {
      assert.equal(provider, 'https://play.google.com/billing');
      if (options.serviceError) throw options.serviceError;
      return service;
    },
    fetch: async (url, init) => {
      assert.equal(url, '/api/google-play');
      backendCalls.push(init);
      return {
        ok: !options.backendUnavailable,
        json: async () => options.backendUnavailable ? { error: 'Prüfserver fehlt' } :
          init.method === 'GET' ? { ready: true } : { premium: options.verified !== false }
      };
    },
    PaymentRequest: class {
      constructor(methods, details) { requests.push({ methods, details }); }
      async show() {
        if (options.showError) throw options.showError;
        return {
          details: { purchaseToken: options.missingToken ? undefined : 'test-token' },
          complete: async status => {
            completions.push(status);
            if (options.completeError) throw new Error('Dialog expired');
          }
        };
      }
    }
  });
  context.window = context;
  vm.runInContext(source, context);
  return { context, alerts, completions, requests, backendCalls,
    premium: () => vm.runInContext('isPremiumUser', context) };
}

test('all inline JavaScript parses', () => {
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script);
});

test('unsupported browsers stay on the page and do not start checkout', async () => {
  const a = app();
  delete a.context.getDigitalGoodsService;
  await a.context.buyGooglePlayPremium();
  assert.match(a.alerts[0], /nicht verfügbar/);
  assert.equal(a.requests.length, 0);
  assert.equal(a.backendCalls.length, 0);
});

test('unavailable Billing service reports the error without opening checkout', async () => {
  const a = app({ serviceError: new Error('Dienst nicht verfügbar') });
  await a.context.buyGooglePlayPremium();
  assert.match(a.alerts[0], /Dienst nicht verfügbar/);
  assert.equal(a.requests.length, 0);
});

test('missing product does not start a purchase', async () => {
  const a = app({ products: [] });
  await a.context.buyGooglePlayPremium();
  assert.match(a.alerts[0], /Produkt.*nicht verfügbar/);
  assert.equal(a.requests.length, 0);
});

test('missing backend blocks checkout before money can be charged', async () => {
  const a = app({ backendUnavailable: true });
  await a.context.buyGooglePlayPremium();
  assert.match(a.alerts[0], /Prüfserver fehlt/);
  assert.equal(a.requests.length, 0);
  assert.equal(a.premium(), false);
});

test('successful checkout verifies the token before granting Premium', async () => {
  const a = app();
  await a.context.buyGooglePlayPremium();
  assert.equal(a.premium(), true);
  assert.equal(a.requests[0].methods[0].supportedMethods, 'https://play.google.com/billing');
  assert.equal(a.requests[0].methods[0].data.sku, product.itemId);
  assert.deepEqual(JSON.parse(a.backendCalls[1].body), { productId: product.itemId, purchaseToken: 'test-token' });
  assert.deepEqual(a.completions, ['success']);
});

test('unverified or pending payment cannot unlock Premium', async () => {
  const a = app({ verified: false });
  await a.context.buyGooglePlayPremium();
  assert.equal(a.premium(), false);
  assert.deepEqual(a.completions, ['fail']);
  assert.match(a.alerts[0], /noch nicht bestätigt/);
});

test('an expired payment dialog does not report a verified purchase as failed', async () => {
  const a = app({ completeError: true });
  await a.context.buyGooglePlayPremium();
  assert.equal(a.premium(), true);
  assert.match(a.alerts[0], /Vielen Dank/);
  assert.deepEqual(a.completions, ['success']);
});

test('missing purchase token cannot unlock Premium', async () => {
  const a = app({ missingToken: true });
  await a.context.buyGooglePlayPremium();
  assert.equal(a.premium(), false);
  assert.deepEqual(a.completions, ['fail']);
});

test('cancelling checkout leaves Premium locked and allows a later retry', async () => {
  const a = app({ showError: Object.assign(new Error('Cancelled'), { name: 'AbortError' }) });
  await a.context.buyGooglePlayPremium();
  await a.context.buyGooglePlayPremium();
  assert.equal(a.premium(), false);
  assert.equal(a.alerts.length, 0);
  assert.equal(a.requests.length, 2);
});

test('double clicks cannot start two purchases', async () => {
  const a = app();
  await Promise.all([a.context.buyGooglePlayPremium(), a.context.buyGooglePlayPremium()]);
  assert.equal(a.requests.length, 1);
});

test('existing purchase is verified and restored without another charge', async () => {
  const a = app({ purchases: [{ itemId: product.itemId, purchaseToken: 'owned-token' }] });
  await a.context.buyGooglePlayPremium();
  assert.equal(a.premium(), true);
  assert.equal(a.requests.length, 0);
  assert.match(a.alerts[0], /wiederhergestellt/);
});

test('startup restores ownership, without trusting an old localStorage flag', async () => {
  const a = app({ purchases: [{ itemId: product.itemId, purchaseToken: 'owned-token' }] });
  a.context.localStorage = { getItem: () => 'true' };
  await a.context.restorePremiumOnStartup();
  assert.equal(a.premium(), true);
  const b = app();
  b.context.localStorage = { getItem: () => 'true' };
  await b.context.restorePremiumOnStartup();
  assert.equal(b.premium(), false);
});

test('published association includes the certificate extracted from the installed APK', () => {
  const statements = JSON.parse(fs.readFileSync(`${__dirname}/../.well-known/assetlinks.json`, 'utf8'));
  const target = statements.find(s => s.target.package_name === 'com.schwarzermarco14.aquadiagnose2').target;
  assert.ok(target.sha256_cert_fingerprints.includes('9A:13:E5:C4:BE:78:05:5A:D9:7D:78:AF:27:48:C2:23:9F:17:A3:26:1C:D0:D0:70:5A:0C:A0:17:81:72:83:4C'));
  for (const fingerprint of target.sha256_cert_fingerprints) assert.match(fingerprint, /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
});
