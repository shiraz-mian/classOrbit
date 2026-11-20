import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, CreditCard, LockKeyhole, RefreshCw } from 'lucide-react';
import { api, money } from '../services/api';
import { Button, EmptyState } from '../components/ui';

export default function CheckoutStatus({ id, data, navigate, onLogin, refresh }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!data.user) return;
    let active = true,
      timer,
      controller = new AbortController(),
      checks = 0;
    setResult(null);
    setError('');
    setChecking(true);
    async function check() {
      try {
        const current = await api('/payments/orders/' + encodeURIComponent(id), {
          signal: controller.signal,
        });
        if (!active) return;
        setResult(current);
        if (current.status === 'PAID') {
          // The server has confirmed capture and saved the enrollment.
          await refresh();
          if (active) setChecking(false);
        } else if (['CREATING', 'PENDING'].includes(current.status) && ++checks < 20) {
          timer = setTimeout(check, 3000);
        } else setChecking(false);
      } catch (e) {
        if (!active) return;
        setError(e.message);
        setChecking(false);
      }
    }
    check();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, data.user?.id, retry, refresh]);

  if (!data.user)
    return (
      <EmptyState
        icon={LockKeyhole}
        title="Sign in to check your payment"
        action={<Button onClick={onLogin}>Sign in</Button>}
      >
        Use the same account you used for checkout.
      </EmptyState>
    );
  const paid = result?.status === 'PAID';
  const failed = result?.status === 'FAILED';
  const title = paid
    ? 'Your course is ready.'
    : failed
      ? 'This checkout could not be created.'
      : error
        ? 'Payment status is unavailable.'
        : 'Confirming your enrollment.';
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">RAZORPAY TEST CHECKOUT</span>
          <h1>{title}</h1>
          <p>No real money is charged in this project’s test checkout.</p>
        </div>
      </div>
      <section className="panel checkout-result" aria-live="polite" aria-busy={checking}>
        {paid ? (
          <CheckCircle2 size={40} />
        ) : failed ? (
          <CreditCard size={40} />
        ) : (
          <Clock3 size={40} />
        )}
        {result && (
          <div>
            <h2>{result.courseTitle}</h2>
            <p>{money(result.amount, result.currency)} · One-time course access</p>
          </div>
        )}
        {error ? (
          <p role="alert">{error}</p>
        ) : paid ? (
          <p>
            Your test payment is confirmed and your enrollment is saved. You can start learning.
          </p>
        ) : failed ? (
          <p>Return to the course to try again. This checkout has not granted access.</p>
        ) : (
          <p>
            {checking
              ? 'Waiting for payment confirmation. This page checks automatically.'
              : 'Confirmation is taking longer than expected. Check again shortly before starting another checkout.'}
          </p>
        )}
        <div className="button-row">
          {!paid && (
            <Button disabled={checking} onClick={() => setRetry((v) => v + 1)}>
              <RefreshCw size={16} />
              {checking ? 'Checking…' : 'Check again'}
            </Button>
          )}
          <Button
            secondary={!paid}
            onClick={() => navigate(result ? 'course/' + result.courseId : 'catalog')}
          >
            {paid ? 'Start learning' : result ? 'Back to course' : 'Explore courses'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </section>
    </>
  );
}
