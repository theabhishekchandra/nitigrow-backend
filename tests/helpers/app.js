const { createApp } = require('../../src/appFactory');

// Returns a fresh Express app bound to the in-memory Mongo set up in tests/setup.js.
// Socket.io is disabled so each test doesn't open dangling listeners; Morgan
// is silenced to keep test output readable.
const buildTestApp = () => {
  const { app, server } = createApp({ enableMorgan: false, enableSocketIo: false });
  return { app, server };
};

module.exports = { buildTestApp };
