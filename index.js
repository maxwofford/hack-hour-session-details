process.env.AIRTABLE_BASE_ID = "app4kCWulfB02bV8Q"

require('dotenv').config()

const commitFieldName = "TEMP: Git commits"
const slackChannel = "C06SBHMQU8G"

const Airtable = require('airtable');

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
})

const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
// get all records from the base with a filter
const records = await base('Sessions').select({
  filterByFormula: `AND({${commitFieldName}} = BLANK(), {Status} = 'Unreviewed')`,
}).all();

console.log("Found", records.length, "record(s)")

const commitRegex = new RegExp('https://github\.com(?:/[^/]+)*/commit/[0-9a-f]{40}')

for (const record of records) {
  const { id, fields } = record
  const messageTS = fields['Message TS']
  const slackMessages = (await getSlackReplies(messageTS) || [])
  let commits = []
  let newMessage = ""
  console.log("Checking", slackMessages.length, "messages")
  slackMessages.forEach(msg => {
    const txt = msg.text
    if (!txt) return
    const matches = txt.match(commitRegex)
    if (matches) {
      commits = commits.concat(matches)
    }
  })
  if (commits.length === 0) {
    console.log("No commits found")
    newMessage = "None"
  } else {
    newMessage = commits.map(c => '- ' + c).join('\n')
  }

  await base('Sessions').update(id, {
    [commitFieldName]: newMessage
  })
  console.log("Updated record", id, "with", commits.length, "commits")
  await sleep(1000)
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSlackReplies(ts) {
  const Slack = require('slack');
  const slack = new Slack({ token: process.env.SLACK_TOKEN });
  const replies = await slack.conversations.replies({
    channel: slackChannel,
    ts: ts
  }).catch(err => {
    console.error(err)
    return []
  });
  return replies.messages
}