require('dotenv').config()

const Airtable = require('airtable');
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base('app4kCWulfB02bV8Q');

import Bottleneck from "bottleneck";
const ratelimiter = new Bottleneck({
  // sane defaults
  maxConcurrent: 2,
  minTime: 100,
  // additional resevior logic based on airtables's docs
  reservoir: 10,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
})

export default {
  sessionsBase: base('Sessions'),
  scrapbookBase: base('Scrapbook'),
  projectBase: base('Projects'),
  reposBase: base('Repos'),
  usersBase: base('Users'),
  verificationsBase: base('YSWS Verification Users'),
  ratelimiter
}