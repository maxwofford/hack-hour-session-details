const { WebClient } = require('@slack/web-api');

// Read a token from the environment variables
require('dotenv').config();
let tokenIndex = 0
function token() {
  let t = process.env.SLACK_TOKEN;
  if (process.env.SLACK_TOKENS) {
    // If we have multiple tokens, pick the next one
    const tokens = process.env.SLACK_TOKENS.split(',');
    t = tokens[tokenIndex % tokens.length];
    tokenIndex += 1
    // log last 5
    console.log("Choose token", t.slice(-5))
  }
  return t
}

const initializeSlack = () => {
  // Initialize
  const slack = new WebClient(token(), {
    rejectRateLimitedCalls: true,
  });
  return slack;
};

// Initialize
const slack = initializeSlack()

export default { slack, initializeSlack };