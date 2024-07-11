const { WebClient } = require('@slack/web-api');

// Read a token from the environment variables
require('dotenv').config();
const token = process.env.SLACK_TOKEN;

// Initialize
const slack = new WebClient(token, {
  rejectRateLimitedCalls: true,
});
export default slack;