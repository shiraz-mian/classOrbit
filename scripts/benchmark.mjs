const base = process.env.BENCHMARK_URL || 'http://localhost:4000';
const count = 30;
const times = [];
for (let i = 0; i < count + 3; i++) {
  const start = performance.now();
  const response = await fetch(base + '/api/bootstrap');
  if (!response.ok) throw new Error('Benchmark request failed: ' + response.status);
  await response.json();
  if (i >= 3) times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      endpoint: '/api/bootstrap',
      requests: count,
      warmup: 3,
      concurrency: 1,
      p50ms: Number(times[Math.floor(count * 0.5)].toFixed(2)),
      p95ms: Number(times[Math.ceil(count * 0.95) - 1].toFixed(2)),
      maxMs: Number(times.at(-1).toFixed(2)),
      note: 'Local demo only, seeded dataset; not a production load test.',
    },
    null,
    2,
  ),
);
