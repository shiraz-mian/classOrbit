// Keep repository tests independent of the developer's real database/payment environment.
process.env.DEMO_MODE = 'true';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
process.env.RAZORPAY_WEBHOOK_SECRET = '';

for (const name of [
  'CLOUDFRONT_URL',
  'CLOUDFRONT_KEY_PAIR_ID',
  'CLOUDFRONT_PRIVATE_KEY',
  'CLOUDFRONT_PRIVATE_KEY_FILE',
  'S3_BUCKET',
])
  process.env[name] = '';
