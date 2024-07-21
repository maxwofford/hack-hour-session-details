import Bottleneck from "bottleneck";

const ratelimiter = new Bottleneck({
  // sane defaults
  concurrent: 2,
  minTime: 5 * 1000,
  // additional resevior logic based on github's docs
  reservoir: 10,
  reservoirIncreaseAmount: 10,
  reservoirIncreaseInterval: 60 * 1000,
});

// optionally set a github token to increase rate limit
// I use a PAT with zero additional scopes (this only makes public API calls)
const headers = process.env.GH_TOKEN
  ? {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
    }
  : {};

export default {
  ratelimiter,
  headers,
};
