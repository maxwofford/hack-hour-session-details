require('dotenv').config()

const { sessionsBase, scrapbookBase, ratelimiter } =
  require("./lib/airtable").default;
const uniq = require("./lib/uniq").default;

const startTime = new Date().toISOString();
let batchUpdateQueue = []
const reviewerRecordID = "rechI0Hf4PLndaT4m"

console.log("Finding bulk sessions");

const bulkSessions = await ratelimiter.schedule(() => sessionsBase.select({
  filterByFormula: `AND(
    {TEMP - Bulk reviewed?} = TRUE(),
    OR(
      {Status} = 'Approved',
      {Status} = 'Banked'
    ),
    NOT({Scrapbook} = BLANK()),
    {TEMP: Hour Review End Time} = BLANK()
  )`,
}).all())

console.log("Found", bulkSessions.length, "bulk sessions");

const scrapbookIDs = uniq(bulkSessions.map(session => (session.get("Scrapbook"))).flat()).filter(Boolean)

console.log("Found", scrapbookIDs.length, "scrapbooks");

const scrapbooks = await ratelimiter.schedule(() => scrapbookBase.select({
  filterByFormula: `OR(${scrapbookIDs.map(id => `RECORD_ID() = '${id}'`).join(", ")})`,
}).all())

for (let i = 0; i < scrapbooks.length; i++) {
  const scrapbook = scrapbooks[i];
  console.log(`${i + 1} / ${scrapbooks.length}`);
  await processScrapbook(scrapbook);
}
updateFromBatch(null, true) // clear out the queue

async function updateFromBatch(record = null, force = false) {
  if (record) {
    batchUpdateQueue.push(record)
  }
  console.log("Batch update queue length", batchUpdateQueue.length)
  if ((force || batchUpdateQueue.length >= 10) && batchUpdateQueue.length > 0) {
    console.log("Pushing update to Airtable")
    await ratelimiter.schedule(() => scrapbookBase.update(batchUpdateQueue))
    batchUpdateQueue = []
  }
}
async function processScrapbook(scrapbookRecord) {
  if (scrapbookRecord.get("Approved")) {
    console.log("Scrapbook is already approved", scrapbookRecord.id);
    // prompt(['Press any key to continue'])
    return;
  }

  if (scrapbookRecord.get('Count Unreviewed Sessions') > 0) {
    console.log("Checking sessions for ", scrapbookRecord.id);
    await Promise.all(scrapbookRecord.get('Sessions').map(async session => {
      let sessionRecord = await ratelimiter.schedule(() => sessionsBase.find(session))
      if (sessionRecord.get('Status') == 'Unreviewed') {
        let sessionFields = {}
        if (sessionRecord.get('Git Commits')) {
          sessionFields['Status'] = 'Approved'
          console.log("Marking approve session", sessionRecord.id);
        } else {
          if (sessionRecord.get('TEMP - Bulk reviewed?')) {
            return
          }
          sessionFields['TEMP - Bulk reviewed?'] = true
          console.log("Marking bulk session", sessionRecord.id);
        }
        await ratelimiter.schedule(() => sessionsBase.update(sessionRecord.id, sessionFields))
      }
    }))
    scrapbookRecord = await ratelimiter.schedule(() => scrapbookBase.find(scrapbookRecord.id))
    if (scrapbookRecord.get('Count Unreviewed Sessions') == 0) {
      console.log("Fixed unreviewed sessions", scrapbookRecord.id);
    } else {
      console.log("Scrapbook has unreviewed sessions", scrapbookRecord.id);
      console.log(`https://airtable.com/app4kCWulfB02bV8Q/pagnimexLMWHJcyc4?eonOF=${scrapbookRecord.id}`)
      // prompt(['Press any key to continue'])
      return;
    }
  }

  if (scrapbookRecord.get('Review Start Time') || scrapbookRecord.get('Review End Time')) {
    console.log("Scrapbook has already been reviewed", scrapbookRecord.id, "setting start and end time");
    console.log(`https://airtable.com/app4kCWulfB02bV8Q/tbl7FAJtLixWxWC2L/viwGpQIjJauoFub8r/${scrapbookRecord.id}?blocks=hide`)
  }

  console.log("Approving scrapbook", scrapbookRecord.id);
  console.log([reviewerRecordID])
  let fieldsToUpdate = {
    "Approved": true,
    "Review Start Time": scrapbookRecord.get("Review Start Time") || startTime,
    "Review End Time": scrapbookRecord.get("Review End Time") || new Date().toISOString(),
    "Reviewed On": scrapbookRecord.get("Reviewed On") || "Script",
    "Reviewer": scrapbookRecord.get("Reviewer") || [reviewerRecordID],
  }
  await updateFromBatch({ id: scrapbookRecord.id, fields: fieldsToUpdate })
}

