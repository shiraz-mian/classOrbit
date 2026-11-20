import { setTimeout as wait } from 'node:timers/promises';

const temporaryCodes = new Set(['P1001', 'P1002', 'P1017', 'P2024']);
export const isTemporaryDatabaseError = (error) =>
  temporaryCodes.has(error?.code) || temporaryCodes.has(error?.errorCode);

// Use only for reads outside transactions: a disconnected write may already have committed.
export async function readWithReconnect(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isTemporaryDatabaseError(error)) throw error;
    await wait(400 + Math.floor(Math.random() * 200));
    return operation();
  }
}
