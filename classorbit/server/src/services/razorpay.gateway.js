import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from './learning.service.js';

export function verifySignature(payload, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature))
    fail(400, 'Invalid payment signature');
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    fail(400, 'Invalid payment signature');
}

export function createPaymentGateway({
  keyId = process.env.RAZORPAY_KEY_ID || '',
  keySecret = process.env.RAZORPAY_KEY_SECRET || '',
  webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '',
  fetchImpl = fetch,
} = {}) {
  if (keyId && !/^rzp_test_[A-Za-z0-9]+$/.test(keyId))
    throw new Error('ClassOrbit accepts Razorpay test keys only.');
  const configured = Boolean(keyId && keySecret);
  async function request(method, resource, body) {
    if (!configured) fail(503, 'Configure Razorpay test keys to enable checkout');
    let response;
    try {
      response = await fetchImpl('https://api.razorpay.com/v1/' + resource, {
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      fail(503, 'Razorpay is temporarily unavailable. Check your payment status before retrying.');
    }
    if (!response.ok) {
      const error = new Error(
        'Razorpay could not complete this request. Check test keys and payment settings.',
      );
      error.status = 503;
      error.providerRejected = response.status >= 400 && response.status < 500;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      fail(
        503,
        'Razorpay returned an unexpected response. Check your payment status before retrying.',
      );
    }
  }
  return {
    configured,
    keyId,
    keySecret,
    webhookSecret,
    createOrder: (quote) =>
      request('POST', 'orders', {
        amount: quote.amount,
        currency: 'INR',
        receipt: quote.id,
        partial_payment: false,
        notes: { app: 'classorbit', checkoutId: quote.id },
      }),
    fetchPayment: (id) => request('GET', 'payments/' + encodeURIComponent(id)),
    fetchOrder: (id) => request('GET', 'orders/' + encodeURIComponent(id)),
    fetchPayments: (id) => request('GET', 'orders/' + encodeURIComponent(id) + '/payments'),
    recoverOrder: async (quote) => {
      const from = Math.floor(new Date(quote.createdAt).getTime() / 1000) - 60;
      for (let skip = 0; skip < 500; skip += 100) {
        const page = await request('GET', 'orders?from=' + from + '&count=100&skip=' + skip);
        if (!Array.isArray(page.items)) fail(503, 'Razorpay order recovery is unavailable');
        const found = page.items.find((order) => order.receipt === quote.id);
        if (found) return found;
        if (page.items.length < 100) break;
      }
      return null;
    },
  };
}
