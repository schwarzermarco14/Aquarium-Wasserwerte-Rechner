const { JWT } = require('google-auth-library');

const PACKAGE_NAME = 'com.schwarzermarco14.aquadiagnose2';
const PRODUCT_ID = 'aquadiagnose_premium';
const PLAY_API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}`;
let client;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Methode nicht erlaubt.' });
  }

  const { productId, purchaseToken } = req.body || {};
  if (req.method === 'POST' && (productId !== PRODUCT_ID ||
      typeof purchaseToken !== 'string' || !purchaseToken.trim() || purchaseToken.length > 4096)) {
    return res.status(400).json({ error: 'Ungültige Kaufdaten.' });
  }

  if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT) {
    return res.status(503).json({ error: 'Die Kaufprüfung ist noch nicht eingerichtet. Bitte kontaktiere den Anbieter.' });
  }

  try {
    if (!client) {
      const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT);
      if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
        throw new Error('Invalid service account configuration');
      }
      client = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/androidpublisher']
      });
    }
    if (req.method === 'GET') {
      // Check credentials and Play Console access before opening a paid checkout.
      await client.request({
        url: `${PLAY_API}/oneTimeProducts/${PRODUCT_ID}`,
        timeout: 10000
      });
      return res.status(200).json({ ready: true });
    }

    const token = encodeURIComponent(purchaseToken);
    const { data: purchase } = await client.request({
      url: `${PLAY_API}/purchases/productsv2/tokens/${token}`,
      timeout: 10000
    });
    const item = purchase.productLineItem?.find(item => item.productId === PRODUCT_ID);
    if (purchase.purchaseStateContext?.purchaseState !== 'PURCHASED' ||
        !item || item.productOfferDetails?.consumptionState !== 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' ||
        item.productOfferDetails.refundableQuantity === 0 || item.productOfferDetails.rentOfferDetails) {
      return res.status(200).json({ premium: false });
    }

    if (purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      await client.request({
        url: `${PLAY_API}/purchases/products/${PRODUCT_ID}/tokens/${token}:acknowledge`,
        method: 'POST',
        data: {},
        timeout: 10000
      });
    } else if (purchase.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
      return res.status(200).json({ premium: false });
    }

    return res.status(200).json({ premium: true });
  } catch (error) {
    // Google errors may contain the purchase token or credentials; never log them.
    const status = error.response?.status;
    if (req.method === 'POST' && [400, 404, 410].includes(status)) {
      return res.status(200).json({ premium: false });
    }
    return res.status(503).json({ error: 'Google Play konnte den Kauf nicht prüfen. Bitte versuche es später erneut.' });
  }
};
