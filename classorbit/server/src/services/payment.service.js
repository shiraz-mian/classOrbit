import { randomUUID } from 'node:crypto';
import { fail } from './learning.service.js';
import { verifySignature } from './razorpay.gateway.js';

export async function ownCheckout(db, id, userId) {
  const order = await db.get('checkoutOrder', id);
  if (!order || order.userId !== userId) fail(404, 'Checkout not found');
  return order;
}

async function bindOrder(db, quote, order) {
  if (
    !/^order_[A-Za-z0-9]+$/.test(order.id) ||
    order.amount !== quote.amount ||
    order.currency !== 'INR' ||
    order.receipt !== quote.id ||
    order.notes?.checkoutId !== quote.id
  )
    fail(400, 'Razorpay order does not match this checkout');
  return db.atomic(async (tx) => {
    const current = await tx.get('checkoutOrder', quote.id);
    if (current.providerOrderId && current.providerOrderId !== order.id)
      fail(409, 'Another order is already attached to this checkout');
    return tx.patch('checkoutOrder', quote.id, {
      providerOrderId: order.id,
      status: current.status === 'PAID' ? 'PAID' : 'PENDING',
      updatedAt: new Date(),
    });
  });
}

export async function createCheckout(db, user, course, gateway) {
  if (!gateway.configured) fail(503, 'Configure Razorpay test keys to enable checkout');
  const { quote, fresh } = await db.atomic(async (tx) => {
    const existing = (await tx.all('checkoutOrder', { userId: user.id, courseId: course.id }))
      .filter(
        (o) =>
          ['CREATING', 'PENDING'].includes(o.status) &&
          o.amount === course.price &&
          o.keyId === gateway.keyId &&
          new Date(o.createdAt).getTime() > Date.now() - 3600000,
      )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (existing) return { quote: existing, fresh: false };
    return {
      fresh: true,
      quote: await tx.insert('checkoutOrder', {
        id: randomUUID(),
        userId: user.id,
        courseId: course.id,
        amount: course.price,
        currency: 'inr',
        status: 'CREATING',
        keyId: gateway.keyId,
        providerOrderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
  });
  try {
    if (!fresh) {
      const current = await syncCheckout(db, quote, gateway);
      if (current.status === 'PAID') return { enrolled: true, test: true, checkoutId: quote.id };
      if (!current.providerOrderId) {
        const error = new Error(
          'Your checkout is still being prepared. Check its status before trying again.',
        );
        error.status = 503;
        throw error;
      }
      return checkoutOptions(current, gateway, course.title);
    }
    const bound = await bindOrder(db, quote, await gateway.createOrder(quote));
    return checkoutOptions(bound, gateway, course.title);
  } catch (error) {
    if (fresh && error.providerRejected)
      await db.patch('checkoutOrder', quote.id, { status: 'FAILED', updatedAt: new Date() });
    error.checkoutId = quote.id;
    throw error;
  }
}

function checkoutOptions(quote, gateway, courseTitle) {
  return {
    checkoutId: quote.id,
    orderId: quote.providerOrderId,
    amount: quote.amount,
    currency: 'INR',
    keyId: gateway.keyId,
    courseTitle,
    test: true,
  };
}

export async function saveCapturedPayment(db, quote, payment) {
  if (
    payment.order_id !== quote.providerOrderId ||
    payment.amount !== quote.amount ||
    payment.currency !== 'INR' ||
    !/^pay_[A-Za-z0-9]+$/.test(payment.id)
  )
    fail(400, 'Payment does not match this course checkout');
  if (payment.status !== 'captured' || payment.captured !== true) return quote;
  if (payment.amount_refunded > 0) fail(409, 'This payment has been refunded');
  return db.atomic(async (tx) => {
    const current = await tx.get('checkoutOrder', quote.id);
    if (current.status === 'PAID') return current;
    const existing = await tx.get('payment', payment.id);
    if (existing && existing.checkoutId !== quote.id)
      fail(409, 'Payment belongs to another checkout');
    if (!existing)
      await tx.insert('payment', {
        id: payment.id,
        checkoutId: quote.id,
        userId: current.userId,
        courseId: current.courseId,
        amount: current.amount,
        currency: 'inr',
        status: 'PAID',
        provider: 'RAZORPAY_TEST',
        createdAt: new Date(),
      });
    if (
      !(await tx.all('enrollment', { userId: current.userId, courseId: current.courseId })).length
    )
      await tx.insert('enrollment', {
        id: randomUUID(),
        userId: current.userId,
        courseId: current.courseId,
        createdAt: new Date(),
      });
    return tx.patch('checkoutOrder', quote.id, { status: 'PAID', updatedAt: new Date() });
  });
}

export async function syncCheckout(db, quote, gateway) {
  if (quote.status === 'PAID' || quote.status === 'FAILED') return quote;
  if (!gateway.configured || quote.keyId !== gateway.keyId)
    fail(503, 'The Razorpay test keys for this checkout are not available');
  if (!quote.providerOrderId) {
    const recovered = await gateway.recoverOrder(quote);
    if (!recovered) return quote;
    quote = await bindOrder(db, quote, recovered);
  }
  const result = await gateway.fetchPayments(quote.providerOrderId);
  if (!Array.isArray(result.items)) fail(503, 'Razorpay payment status is unavailable');
  const captured = result.items.find((p) => p.status === 'captured' && p.captured === true);
  if (captured) return saveCapturedPayment(db, quote, await gateway.fetchPayment(captured.id));
  return quote;
}

export async function verifyCheckout(db, user, input, gateway) {
  const quote = await ownCheckout(db, input.checkoutId, user.id);
  if (!gateway.configured || quote.keyId !== gateway.keyId)
    fail(503, 'Razorpay test checkout is not configured');
  if (!quote.providerOrderId || quote.providerOrderId !== input.razorpay_order_id)
    fail(400, 'Payment order does not match this checkout');
  verifySignature(
    quote.providerOrderId + '|' + input.razorpay_payment_id,
    input.razorpay_signature,
    gateway.keySecret,
  );
  const payment = await gateway.fetchPayment(input.razorpay_payment_id);
  return saveCapturedPayment(db, quote, payment);
}

export async function checkoutStatus(db, quote) {
  const course = await db.get('course', quote.courseId);
  return {
    checkoutId: quote.id,
    status: quote.status,
    courseId: quote.courseId,
    courseTitle: course?.title,
    amount: quote.amount,
    currency: quote.currency,
  };
}
