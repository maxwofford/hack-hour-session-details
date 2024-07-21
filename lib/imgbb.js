import Bottleneck from "bottleneck";

const ratelimiter = new Bottleneck({
  // sane defaults
  concurrent: 1,
  minTime: 3 * 1000,
  // additional resevior logic based on intuition
  reservoir: 10,
  reservoirIncreaseAmount: 5,
  reservoirIncreaseInterval: 60 * 1000,
});

export default { ratelimiter }