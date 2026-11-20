import { readWithReconnect } from '../services/database-retry.js';

export function createPrismaRepository(client) {
  const wrap = (connection, inTransaction = false) => {
    const read = (operation) => (inTransaction ? operation() : readWithReconnect(operation));
    return {
      all: (model, where = {}) => read(() => connection[model].findMany({ where })),
      get: (model, id) => read(() => connection[model].findUnique({ where: { id } })),
      insert: (model, data) => connection[model].create({ data }),
      patch: (model, id, data) => connection[model].update({ where: { id }, data }),
      atomic: (fn) =>
        client.$transaction((tx) => fn(wrap(tx, true)), { isolationLevel: 'Serializable' }),
      close: () => client.$disconnect(),
    };
  };
  return wrap(client);
}
