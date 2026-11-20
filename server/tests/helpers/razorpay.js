import { createHmac, randomBytes } from 'node:crypto';
export function fakeRazorpay() {
  const keyId = 'rzp_test_fixture',
    keySecret = 'isolated-test-key-secret',
    webhookSecret = 'isolated-test-webhook-secret';
  const fixtureId = randomBytes(6).toString('hex');
  const orders = new Map(),
    payments = new Map(),
    calls = [];
  const state = { orders, payments, calls, timeoutAfterCreate: false, failReads: false };
  const respond = (body, status = 200) => Response.json(body, { status });
  const fetchImpl = async (url, options) => {
    const resource = new URL(url).pathname.slice('/v1/'.length);
    calls.push({ method: options.method, resource });
    if (options.method === 'POST' && resource === 'orders') {
      const input = JSON.parse(options.body);
      const order = {
        ...input,
        id: 'order_fixture' + fixtureId + (orders.size + 1),
        entity: 'order',
        status: 'created',
      };
      orders.set(order.id, order);
      if (state.timeoutAfterCreate) {
        state.timeoutAfterCreate = false;
        throw new Error('Simulated timeout after order creation');
      }
      return respond(order);
    }
    if (state.rejectReads) return respond({}, 401);
    if (state.failReads) throw new Error('Simulated provider outage');
    if (resource === 'orders') return respond({ items: [...orders.values()] });
    if (resource.startsWith('payments/'))
      return payments.has(resource.slice(9))
        ? respond(payments.get(resource.slice(9)))
        : respond({}, 404);
    const match = resource.match(new RegExp('^orders/(order_[A-Za-z0-9]+)(/payments)?$'));
    if (match?.[2])
      return respond({ items: [...payments.values()].filter((p) => p.order_id === match[1]) });
    if (match && orders.has(match[1])) return respond(orders.get(match[1]));
    return respond({}, 404);
  };
  const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('hex');
  return {
    state,
    options: { keyId, keySecret, webhookSecret, fetchImpl },
    capture(orderId, overrides = {}) {
      const order = orders.get(orderId);
      const payment = {
        id: 'pay_fixture' + fixtureId + (payments.size + 1),
        entity: 'payment',
        order_id: orderId,
        amount: order.amount,
        currency: order.currency,
        status: 'captured',
        captured: true,
        amount_refunded: 0,
        ...overrides,
      };
      payments.set(payment.id, payment);
      return payment;
    },
    callback(checkout, payment) {
      return {
        checkoutId: checkout.checkoutId,
        razorpay_order_id: checkout.orderId,
        razorpay_payment_id: payment.id,
        razorpay_signature: sign(checkout.orderId + '|' + payment.id, keySecret),
      };
    },
    event(payment, event = 'payment.captured') {
      const body = JSON.stringify({
        entity: 'event',
        event,
        payload: { payment: { entity: payment } },
      });
      return { body, signature: sign(body, webhookSecret) };
    },
  };
}
