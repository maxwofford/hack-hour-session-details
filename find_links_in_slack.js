import Bottleneck from 'bottleneck'
import { sleep } from 'bun'
import uniq from './lib/uniq'

const airtableBaseID = "app4kCWulfB02bV8Q"

require('dotenv').config()

const commitFieldName = "Git commits"
const linkFieldName = "All links"
const slackChannel = "C06SBHMQU8G"

const Airtable = require('airtable');

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
})

const base = Airtable.base(airtableBaseID);

const processByFormula = async (formula) => {
  // get all records from the base with a filter
  console.log("Looking for records with formula", formula)
  let records = await base('Sessions').select({
    filterByFormula: formula,
    // maxRecords: 100 // prevent the script from choking on too many records
  }).all();

  console.log("Found", records.length, "record(s)")

  if (records.length === 0) { return false }

  if (records.length > 1000) {
    records = records.slice(0, 1000)
    console.log("Processing only the first 1000 records")
  }

  for (let i = 0; i < records.length; i += 10) {
    const recordsSlice = records.slice(i, i + 10)
    console.log(`Working on chunk ${i} to ${i + 10} of ${records.length}`)
    await processRecords(recordsSlice)
  }
  await sleep(1000)
  return true
}

const slackTokenCount = 3
const slackRatelimitter = new Bottleneck({
  // sane defaults
  maxConcurrent: 2 * slackTokenCount,
  minTime: 500,
  // additional resevior logic based on slack's docs
  reservoir: 50 * slackTokenCount,
  reservoirRefreshAmount: 50 / 10,
  reservoirRefreshInterval: 60 * 1000 / 10 / slackTokenCount,
})
const rateLimitedSlackRequest = slackRatelimitter.wrap(getSlackReplies)
async function getSlackReplies(ts) {
  const slack = require('./lib/slack').default.initializeSlack()
  try {
    const replies = await slack.conversations.replies({
      channel: slackChannel,
      ts
    })

    return replies.messages.map(m => {
      let blockText = ''
      if (m.blocks) {
        function getBlockText(block, recursion = 0) {
          if (recursion > 10) {return ''}
          if (block.text) {
            if (typeof block.text == 'string') {
              return block.text
            } else {
              return getBlockText(block.text)
            }
          } else {
            if (Object.keys(block).length === 0) {
              return ''
            } else {
              return Object.values(block).map(b => getBlockText(b, recursion + 1)).join('')
            }
          }
        }
        blockText = getBlockText(m.blocks)
      }
      return m.text + blockText
    })
  } catch(e) {
    console.error(e)
    return []
  }
}

const airtableRatelimiter = new Bottleneck({
  // sane defaults
  maxConcurrent: 2,
  minTime: 100,
  // additional resevior logic based on airtables's docs
  reservoir: 10,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60 * 1000,
})
const ratelimitedUpdateSessionsBatch = airtableRatelimiter.wrap(updateSessionsBatch)
async function updateSessionsBatch(records) {
  return await base('Sessions').update(records)
}


function findUrlsInText(text, regex) {
  const matches = text.match(regex);
  return matches || [];
}

function findGhLinksInText(text) {
  const commitRegex = new RegExp(
    "https://github.com(?:/[^/]+)*/commit/[0-9a-f]{40}",
    "g"
  );
  const repoRegex = new RegExp("https://github\\.com/([a-zA-Z0-9_-]+)/([a-zA-Z0-9_.-]+)", "g");
  const prRegex = new RegExp("https://github.com(?:/[^/]+)*/pull/[0-9]+", "g");
  const issueRegex = new RegExp("https://github.com(?:/[^/]+)*/issue/[0-9]+", "g");
  const releventLinks = [
    ...findUrlsInText(text, commitRegex),
    ...findUrlsInText(text, prRegex),
    ...findUrlsInText(text, repoRegex),
    ...findUrlsInText(text, issueRegex),
  ];

  return uniq(releventLinks.filter(Boolean));
}

function findAllLinksInText(text) {
  // handling slack links means finding links inside of slack formatting, like <https://google.com|google> or <https://google.com>
  const linkRegex = new RegExp(
    "https?://[^\\s|<\>]+",
    "g"
  );
  const foundLinks = [
    ...findUrlsInText(text, linkRegex),
  ]
  return uniq(foundLinks.filter(Boolean));
}

const processRecords = async (records) => {
  let recordsToUpdate = []
  for (const record of records) {
    const { id, fields } = record
    const messageTS = fields['Message TS']
    const slackMessages = (await rateLimitedSlackRequest(messageTS) || [])
    let ghLinks = record.fields[commitFieldName]?.split('\n').map(t => t.replace('- ', '')) || []
    let allLinks = record.fields[linkFieldName]?.split('\n').map(t => t.replace('- ', '')) || []
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

    const ghLinksText = uniq(ghLinks).map(c => '- ' + c).join('\n')
    const allLinksText = uniq(allLinks).map(c => '- ' + c).join('\n')

    recordsToUpdate.push({
      id: record.id,
      fields: {
        [commitFieldName]: ghLinksText,
        [linkFieldName]: allLinksText,
        "Last checked for links at": new Date()
      },
    })
    
    console.log("\tFound", ghLinks.length, "gh links & ", allLinks.length, "all links for record", id)
  }
  console.log("Saving updates to current batch of records!")

  await ratelimitedUpdateSessionsBatch(recordsToUpdate)
}

await processByFormula(`{Last checked for links at} = BLANK()`) ||
await processByFormula(
  `AND(
    DATETIME_DIFF(NOW(), {Last checked for links at}, 'minutes') > ${60 * 24},
    OR(
      {${commitFieldName}} = BLANK(),
      {${linkFieldName}} = BLANK()
    )
  )`
) ||
await processByFormula(`DATETIME_DIFF(NOW(), {Last checked for links at}, 'minutes') > ${60 * 24 * 7} `) ||
await sleep(1000 * 60)