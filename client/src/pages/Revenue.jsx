import { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { Download, TrendingUp, Users, Wallet, ArrowUpRight, RefreshCw } from 'lucide-react';
import { api, money, dateTime } from '../services/api';
import { Button, Loader, EmptyState } from '../components/ui';
Chart.register(...registerables);
export default function Revenue({ notify }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await api('/studio/revenue'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  const canvas = useRef();
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!data || !canvas.current) return;
    const months = Array.from(
      { length: 6 },
      (_, i) => new Date(new Date().getFullYear(), new Date().getMonth() - 5 + i, 1),
    );
    const values = months.map(
      (m) =>
        data.payments
          .filter(
            (p) =>
              p.currency.toLowerCase() === 'inr' &&
              new Date(p.createdAt).getMonth() === m.getMonth() &&
              new Date(p.createdAt).getFullYear() === m.getFullYear(),
          )
          .reduce((s, p) => s + p.amount, 0) / 100,
    );
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: {
        labels: months.map((m) => m.toLocaleDateString(undefined, { month: 'short' })),
        datasets: [
          {
            label: 'Gross revenue (INR)',
            data: values,
            backgroundColor: months.map((m, i) => (i === 5 ? '#f38b6d' : '#e7eee9')),
            borderRadius: 5,
            maxBarThickness: 52,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => money(c.raw * 100) } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: '#edf0ee' },
            border: { display: false },
            ticks: { callback: (v) => '₹' + v },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [data]);
  function exportCSV() {
    const rows = [
      ['Payment ID', 'Course', 'Amount', 'Currency', 'Provider', 'Date'],
      ...data.payments.map((p) => [
        p.id,
        data.courses.find((c) => c.id === p.courseId)?.title,
        (p.amount / 100).toFixed(2),
        p.currency.toUpperCase(),
        p.provider,
        new Date(p.createdAt).toISOString(),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ClassOrbit-test-revenue.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  if (!data && error)
    return (
      <EmptyState
        title="Earnings could not load"
        action={<Button onClick={load}>Try again</Button>}
      >
        {error}
      </EmptyState>
    );
  if (!data) return <Loader />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE VALUE OF SHARING WHAT YOU KNOW</span>
          <h1>Your impact, in numbers.</h1>
          <p>Course revenue and the people you’re helping move forward.</p>
        </div>
        <div className="button-row">
          <Button secondary disabled={loading} onClick={load}>
            <RefreshCw size={16} />
            {loading ? 'Refreshing…' : 'Refresh earnings'}
          </Button>
          <Button secondary onClick={exportCSV}>
            <Download size={16} />
            Export report
          </Button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="revenue-notice">
        TEST MODE · These are demo or Razorpay test transactions. No real payouts are made. The
        instructor share uses a 10% platform fee. Totals and charts use INR; older transactions
        retain their original currency.
      </div>
      <div className="revenue-stats">
        {[
          [Wallet, 'Gross course revenue', money(data.gross)],
          [TrendingUp, 'Estimated instructor share', money(data.gross - data.platformFee)],
          [Users, 'Total enrollments', data.enrollments.length],
        ].map(([Icon, label, value]) => (
          <div className="panel revenue-stat" key={label}>
            <span className="stat-icon mint">
              <Icon size={23} />
            </span>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="revenue-columns">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>The bigger picture</h2>
              <p className="muted">Gross course revenue · Last 6 months</p>
            </div>
            <span className="currency-tag">INR</span>
          </div>
          <div className="revenue-chart">
            <canvas ref={canvas} aria-label="Monthly course revenue" role="img" />
          </div>
        </section>
        <section className="panel course-performance">
          <h2>Course performance</h2>
          {data.courses.map((c) => (
            <div key={c.id}>
              <span className={'performance-dot ' + c.color} />
              <span>
                <b>{c.title}</b>
                <small>
                  {data.enrollments.filter((e) => e.courseId === c.id).length} enrollments
                </small>
              </span>
              <strong>
                {money(
                  data.payments
                    .filter((p) => p.courseId === c.id && p.currency.toLowerCase() === 'inr')
                    .reduce((s, p) => s + p.amount, 0),
                )}
              </strong>
            </div>
          ))}
        </section>
      </div>
      <section className="panel transactions-panel">
        <div className="section-heading">
          <h2>Recent transactions</h2>
          <span className="muted">{data.payments.length} payments</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Date</th>
                <th>Provider</th>
                <th>Gross amount</th>
                <th>Instructor share</th>
              </tr>
            </thead>
            <tbody>
              {[...data.payments]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map((p) => (
                  <tr key={p.id}>
                    <td>{data.courses.find((c) => c.id === p.courseId)?.title}</td>
                    <td>{dateTime(p.createdAt)}</td>
                    <td>
                      <span className="status-badge draft">
                        {p.provider === 'DEMO'
                          ? 'Demo payment'
                          : p.provider === 'RAZORPAY_TEST'
                            ? 'Razorpay test'
                            : 'Legacy test payment'}
                      </span>
                    </td>
                    <td>{money(p.amount, p.currency)}</td>
                    <td>{money(p.amount - Math.round(p.amount * 0.1), p.currency)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!data.payments.length && (
          <EmptyState title="Your next chapter is taking shape">
            Course payments will appear here.
          </EmptyState>
        )}
      </section>
    </>
  );
}
