/**
 * In-memory stand-in for the Prisma delegates the common-sequence code uses
 * (aggregate / updateMany / create / delete / findUnique), so ordering tests
 * run the real sequence logic without a database.
 *
 * It enforces the same per-parent uniqueness the real schema does — every
 * table's (parent, order) pair must be unique after each statement — so a
 * shift that would transiently collide fails the test the way it would fail
 * in Postgres. Not a *.test.js file, so `node --test test/*.test.js` never
 * runs it on its own.
 */
const PARENT_FIELDS = ["courseId", "moduleId", "lessonId", "topicId", "subTopicId", "conceptId"];
const MOST_SPECIFIC_FIRST = [...PARENT_FIELDS].reverse();
const DELEGATES = ["content", "quiz", "assignment", "module", "lesson", "topic", "subTopic", "concept", "quizQuestion", "quizSubmission"];
const CHILD_PARENT_FIELD = { module: "courseId", lesson: "moduleId", topic: "lessonId", subTopic: "topicId", concept: "subTopicId" };

function fieldMatches(value, condition) {
  if (condition === null) return value === null || value === undefined;
  if (condition && typeof condition === "object" && !(condition instanceof Date)) {
    if ("gte" in condition && !(typeof value === "number" && value >= condition.gte)) return false;
    if ("gt" in condition && !(typeof value === "number" && value > condition.gt)) return false;
    if ("lt" in condition && !(typeof value === "number" && value < condition.lt)) return false;
    if ("lte" in condition && !(typeof value === "number" && value <= condition.lte)) return false;
    if ("in" in condition && !condition.in.includes(value)) return false;
    return true;
  }
  return value === condition;
}

// Field conditions plus the boolean combinators the services actually use
// (deleteModule collects its descendants' quizzes with an OR).
function rowMatches(row, where = {}) {
  return Object.entries(where).every(([field, condition]) => {
    if (field === "OR") return (condition || []).some((clause) => rowMatches(row, clause));
    if (field === "AND") return (condition || []).every((clause) => rowMatches(row, clause));
    if (field === "NOT") return !rowMatches(row, condition);
    return fieldMatches(row[field], condition);
  });
}

function createSequenceDb() {
  const tables = Object.fromEntries(DELEGATES.map((name) => [name, []]));
  let idCounter = 0;
  let clock = Date.parse("2026-01-01T00:00:00.000Z");

  const uniquenessKey = (name, row) => {
    const field = CHILD_PARENT_FIELD[name] || MOST_SPECIFIC_FIRST.find((f) => row[f]);
    return field ? `${field}:${row[field]}` : null;
  };

  const assertUnique = (name) => {
    const seen = new Set();
    for (const row of tables[name]) {
      if (typeof row.order !== "number") continue;
      const key = `${uniquenessKey(name, row)}#${row.order}`;
      if (seen.has(key)) throw new Error(`Unique constraint violated on ${name} (${key})`);
      seen.add(key);
    }
  };

  const delegate = (name) => ({
    aggregate: async ({ where, _max, _min }) => {
      const orders = tables[name]
        .filter((row) => rowMatches(row, where))
        .map((row) => row.order)
        .filter((order) => typeof order === "number");
      const result = {};
      if (_max) result._max = { order: orders.length ? Math.max(...orders) : null };
      if (_min) result._min = { order: orders.length ? Math.min(...orders) : null };
      return result;
    },
    updateMany: async ({ where, data }) => {
      const rows = tables[name].filter((row) => rowMatches(row, where));
      for (const row of rows) {
        const change = data.order;
        if (change && typeof change === "object") {
          if ("increment" in change) row.order += change.increment;
          if ("decrement" in change) row.order -= change.decrement;
        } else if (change !== undefined) {
          row.order = change;
        }
      }
      assertUnique(name);
      return { count: rows.length };
    },
    create: async ({ data }) => {
      const row = {
        id: data.id || `${name}-${++idCounter}`,
        createdAt: new Date((clock += 1000)),
        ...Object.fromEntries(PARENT_FIELDS.map((field) => [field, null])),
        ...data,
      };
      tables[name].push(row);
      assertUnique(name);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = tables[name].find((r) => r.id === where.id);
      Object.assign(row, data);
      assertUnique(name);
      return { ...row };
    },
    delete: async ({ where }) => {
      const index = tables[name].findIndex((row) => row.id === where.id);
      const [row] = tables[name].splice(index, 1);
      return row;
    },
    findUnique: async ({ where }) => {
      const row = tables[name].find((r) => r.id === where.id);
      return row ? { ...row, quizQuestions: [] } : null;
    },
    findMany: async ({ where } = {}) => tables[name].filter((row) => rowMatches(row, where)).map((row) => ({ ...row })),
    deleteMany: async ({ where } = {}) => {
      const keep = tables[name].filter((row) => !rowMatches(row, where));
      const count = tables[name].length - keep.length;
      tables[name] = keep;
      return { count };
    },
  });

  const db = Object.fromEntries(DELEGATES.map((name) => [name, delegate(name)]));
  db.locks = [];
  db.$queryRaw = async (strings, ...values) => {
    db.locks.push(values[0]);
    return [{ locked: "" }];
  };
  // Prisma accepts both forms: an interactive callback (the sequence code) and
  // an array of queries (the two-phase reorders).
  db.$transaction = async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg));
  db.tables = tables;

  /** A parent's items of every type, in sequence order, as "kind:id@order". */
  db.sequenceOf = (parentField, parentId) => {
    const deeper = PARENT_FIELDS.slice(PARENT_FIELDS.indexOf(parentField) + 1);
    const own = (row) => row[parentField] === parentId && deeper.every((f) => row[f] === null || row[f] === undefined);
    const items = [];
    for (const name of ["content", "quiz", "assignment"]) {
      for (const row of tables[name].filter(own)) items.push({ name, row });
    }
    for (const [name, field] of Object.entries(CHILD_PARENT_FIELD)) {
      if (field !== parentField) continue;
      for (const row of tables[name].filter((r) => r[field] === parentId)) items.push({ name, row });
    }
    return items
      .sort((a, b) => a.row.order - b.row.order)
      .map(({ name, row }) => `${name}:${row.title || row.id}@${row.order}`);
  };

  return db;
}

/**
 * A transaction stub for tests that only mock `create` (and friends) on
 * `prisma`. Creates now claim their order inside `prisma.$transaction`, so the
 * service is handed a `tx` — this one forwards every call to whatever the test
 * mocked on `prisma`, and answers the sequence's `aggregate` lookups from
 * `maxOrderByDelegate` (default: an empty parent).
 *
 * Returns the stub plus the recorded aggregate calls, so a test can assert
 * which parent the order was computed against.
 */
function createTransactionStub(prisma, { maxOrderByDelegate = {} } = {}) {
  const aggregateCalls = [];

  const delegate = (name) =>
    new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "aggregate") {
            return async ({ where, _max, _min }) => {
              aggregateCalls.push({ delegate: name, where });
              const value = Object.prototype.hasOwnProperty.call(maxOrderByDelegate, name)
                ? maxOrderByDelegate[name]
                : null;
              return {
                ...(_max ? { _max: { order: value } } : {}),
                ...(_min ? { _min: { order: value } } : {}),
              };
            };
          }
          return (...args) => prisma[name][prop](...args);
        },
      }
    );

  const tx = Object.fromEntries(DELEGATES.map((name) => [name, delegate(name)]));
  const $transaction = async (arg) => (typeof arg === "function" ? arg(tx) : Promise.all(arg));

  return { tx, $transaction, aggregateCalls };
}

module.exports = { createSequenceDb, createTransactionStub };
