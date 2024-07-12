const airtableBaseID = "app4kCWulfB02bV8Q"

require('dotenv').config()

const commitFieldName = "TEMP: Git commits"
const linkFieldName = "TEMP: All links"
const slackChannel = "C06SBHMQU8G"

const Airtable = require('airtable');

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
})

const base = Airtable.base(airtableBaseID);
// get all records from the base with a filter
const records = await base('Sessions').select({
  filterByFormula: `AND({${commitFieldName}} = BLANK(), {Status} = 'Unreviewed')`,
  maxRecords: 1000 // prevent the script from choking on too many records
}).all();

console.log("Found", records.length, "record(s)")

function findUrlsInText(text, regex) {
  const matches = text.match(regex);
  return matches || [];
}

function findGhLinksInText(text) {
  const commitRegex = new RegExp(
    "https://github.com(?:/[^/]+)*/commit/[0-9a-f]{40}",
    "g"
  );
  const repoRegex = new RegExp("https://github.com/([^/]+)/([^/]+)", "g");
  const prRegex = new RegExp("https://github.com(?:/[^/]+)*/pull/[0-9]+", "g");
  const generalGhRegex = new RegExp("https://github.com(?:/[^/]+)*/[^/]+", "g");
  const releventLinks = [
    ...findUrlsInText(text, commitRegex),
    ...findUrlsInText(text, prRegex),
    ...findUrlsInText(text, repoRegex),
    ...findUrlsInText(text, generalGhRegex),
  ];

  return unique(releventLinks.filter(Boolean));
}

function findAllLinksInText(text) {
  // handling slack links means finding links inside of slack formatting, like <https://google.com|google> or <https://google.com>
  const linkRegex = new RegExp(
    "https?://[^\\s]+",
    "g"
  );
  const slackLinkRegex = new RegExp(
    "<https?://[^\\s]+\\|[^\\s]+>",
    "g"
  );
  const foundLinks = [
    ...findUrlsInText(text, linkRegex),
    ...findUrlsInText(text, slackLinkRegex),
  ]
  return unique(foundLinks.filter(Boolean));
}

function unique(arr) {
  return [...new Set(arr)];
}

for (let i = 0; i < records.length; i += 10) {
  const recordsSlice = records.slice(i, i + 10)
  console.log(`Working on chunk ${i} to ${i + 10} of ${records.length}`)
  await processRecords(recordsSlice)
}

async function processRecords(records) {
  let recordsToUpdate = []
  for (const record of records) {
    const { id, fields } = record
    const messageTS = fields['Message TS']
    const slackMessages = (await getSlackReplies(messageTS) || [])
    let ghLinks = []
    let allLinks = []
    console.log("\tChecking", slackMessages.length, "messages")
    slackMessages.forEach(txt => {
      if (!txt) return
      const ghMatches = findGhLinksInText(txt)
      const allMatches = findAllLinksInText(txt)
      if (ghMatches) {
        ghLinks = ghLinks.concat(ghMatches)
      }
      if (allMatches) {
        allLinks = allLinks.concat(allMatches)
      }
    })
    const ghLinksText = ghLinks.map(c => '- ' + c).join('\n') || "None"
    const allLinksText = allLinks.map(c => '- ' + c).join('\n') || "None"

    recordsToUpdate.push({
      id: record.id,
      fields: {
        [commitFieldName]: ghLinksText,
        [linkFieldName]: allLinksText,
      },
    })
    
    console.log("\tFound", ghLinks.length, "gh links & ", allLinks.length, "all links for record", id)
  }
  console.log("Saving updates to current batch of records!")

  await base('Sessions').update(recordsToUpdate)
  await sleep(5000)
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSlackReplies(ts) {
  const slack = require('./lib/slack').default
  const replies = await slack.conversations.replies({
    channel: slackChannel,
    ts
  }).catch(err => {
    console.error(err)
    return []
  })

  return replies.messages.map(m => m.text)
}