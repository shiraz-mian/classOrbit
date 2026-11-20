import { Router, raw } from 'express';
import { createHash } from 'node:crypto';
import { verifySignature } from '../services/razorpay.gateway.js';
import { saveCapturedPayment } from '../services/payment.service.js';
export function createRouter(db, gateway) {
  const app = Router();
  app.post(
    '/api/payments/razorpay/webhook',
    raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      if (!gateway.configured || !gateway.webhookSecret)
        return res.status(503).json({ error: 'Razorpay webhook is not configured' });
      let event;
      try {
        verifySignature(req.body, req.headers['x-razorpay-signature'], gateway.webhookSecret);
        event = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid webhook signature or payload' });
      }
      if (!['payment.captured', 'order.paid'].includes(event.event))
        return res.json({ received: true });
      const entity = event.payload?.payment?.entity;
      if (
        !entity ||
        !/^pay_[A-Za-z0-9]+$/.test(entity.id) ||
        !/^order_[A-Za-z0-9]+$/.test(entity.order_id)
      )
        return res.status(400).json({ error: 'Invalid Razorpay payment event' });
      // The provider header is not signed. Hash the signed body so changing headers cannot hide another event.
      const eventId = 'razorpay:' + createHash('sha256').update(req.body).digest('hex');
      try {
        if (await db.get('webhookEvent', eventId)) return res.json({ received: true });
        let quote = (await db.all('checkoutOrder', { providerOrderId: entity.order_id }))[0];
        if (!quote) {
          const providerOrder = await gateway.fetchOrder(entity.order_id);
          if (providerOrder.notes?.app !== 'classorbit') return res.json({ received: true });
          quote = await db.get('checkoutOrder', providerOrder.notes.checkoutId);
          if (!quote) return res.json({ received: true });
          if (
            providerOrder.receipt !== quote.id ||
            providerOrder.amount !== quote.amount ||
            providerOrder.currency !== 'INR'
          )
            return res.status(400).json({ error: 'Payment order does not match this checkout' });
          if (quote.providerOrderId && quote.providerOrderId !== entity.order_id)
            return res.status(400).json({ error: 'Payment order does not match this checkout' });
          quote = await db.patch('checkoutOrder', quote.id, {
            providerOrderId: entity.order_id,
            updatedAt: new Date(),
          });
        }
        if (quote.keyId !== gateway.keyId)
          return res.status(400).json({ error: 'Payment account does not match' });
        const current = await saveCapturedPayment(db, quote, await gateway.fetchPayment(entity.id));
        if (current.status !== 'PAID')
          return res.status(500).json({ error: 'Payment is not captured yet; retry delivery' });
        try {
          await db.insert('webhookEvent', { id: eventId, createdAt: new Date() });
        } catch (error) {
          if (error.code !== 'P2002') throw error;
        }
        res.json({ received: true });
      } catch (error) {
        if (error.status === 400) return res.status(400).json({ error: error.message });
        console.error('Razorpay fulfillment failed; delivery can be retried');
        res.status(500).json({ error: 'Fulfillment failed; retry delivery' });
      }
    },
  );
  return app;
}
