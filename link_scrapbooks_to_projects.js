require('dotenv').config()

const Airtable = require('airtable');
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
})
const base = Airtable.base("app4kCWulfB02bV8Q");

const scrapbookBase = base("Scrapbook");
const sessionBase = base("Sessions");


function findUrlsInText(text, regex) {
  const matches = text.match(regex)
  return matches || []
}

function findReposInText(text) {
  const commitRegex = new RegExp('https://github\.com(?:/[^/]+)*/commit/[0-9a-f]{40}', 'g')
  const repoRegex = new RegExp('https://github\.com/([^/]+)/([^/]+)', 'g')
  const prRegex = new RegExp('https://github\.com(?:/[^/]+)*/pull/[0-9]+', 'g')
  const repoLinks = [
    ...findUrlsInText(text, repoRegex),
    ...findUrlsInText(text, prRegex),
    ...findUrlsInText(text, commitRegex),
  ]
  
  return unique(repoLinks.map(parseGithubUrl).filter(Boolean))
}

function unique(arr) {
  return [...new Set(arr)]
}

function parseGithubUrl(url) {
  try {
    const u = new URL(url)
    const [_, username, repo] = u.pathname.split('/')
    return `${username}/${repo}`
  } catch (e) {
    return null
  }
}

// main function

// get all records from the base with a filter
const filter = [
  "NOT({TEMP: Git commits} = BLANK())",
  "NOT({TEMP: Git commits} = 'None')",
  "{Status} = 'Banked'"
]

const sessionRecords = await sessionBase.select({
  maxRecords: 1,
  filterByFormula: `AND(${filter.join(',')})`
}).all()

const session = sessionRecords[0]
const projects = findReposInText(session.fields["TEMP: Git commits"])

projects.forEach(async (project) => {
  const projectRecords = await projectBase.select({
    filterByFormula: `{Name} = '${project}'`,
    maxRecords: 1
  }).all()

  const projectRecord = projectRecords[0]
  if (projectRecord) {
    await sessionBase.update(session.id, {
      "Project": [projectRecord.id]
    })
  }
})