export async function api(url, options = {}) {
  const response = await fetch('/api' + url, {
    credentials: 'include',
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'The server returned an unexpected response' }));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    if (data.checkoutId) error.checkoutId = data.checkoutId;
    throw error;
  }
  return data;
}
export const post = (url, body = {}) => api(url, { method: 'POST', body });
export const money = (amount, currency = 'INR') =>
  new Intl.NumberFormat(currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);
export const dateTime = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
