const log = {
  info:  (msg, data = '') => console.log(`[INFO]  ${msg}`, data),
  error: (msg, data = '') => console.error(`[ERROR] ${msg}`, data),
  step:  (msg)            => console.log(`[STEP]  ✦ ${msg}`),
  done:  (msg)            => console.log(`[DONE]  ✓ ${msg}`),
};

module.exports = log;
