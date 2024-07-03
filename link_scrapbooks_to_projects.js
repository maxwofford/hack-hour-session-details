require('dotenv').config()

const Airtable = require('airtable');
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
})
const base = Airtable.base("app4kCWulfB02bV8Q");

const scrapbookBase = base("Scrapbook");
const sessionBase = base("Sessions");
const projectBase = base("Projects");

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

const scrapbookFilter = [
  "Approved = TRUE()",
  "{Linked Sessions Count} > 0",
  "NOT({TEMP: Commits} = BLANK())",
  "{Projects} = BLANK()"
]
const scrapbookRecords = await scrapbookBase.select({
  maxRecords: 1,
  filterByFormula: `AND(${scrapbookFilter.join(',')})`
}).all()
const scrapbook = scrapbookRecords[0]
console.log(scrapbook.fields["Text"])
console.log(scrapbook.fields["TEMP: Commits"])
const projects = findReposInText(scrapbook.fields["TEMP: Commits"].join('\n'))
if (projects.length > 1) {
  // uh oh...
  console.log("Multiple projects found...")
  console.log(projects)
} else if (projects.length === 1) {
  const projectRecords = await projectBase.select({
    filterByFormula: `{Name} = '${projects[0]}'`,
    maxRecords: 1
  }).all()
  let projectRecord = projectRecords[0]
  if (projectRecord) {
    await scrapbookBase.update(scrapbook.id, {
      "Projects": [projectRecord.id]
    })
  } else {
    let playableLink = ''
    const ghData = await fetch(`https://api.github.com/repos/${projects[0]}`).then(r => r.json())
    if (ghData.has_pages) {
      playableLink = `${ghData.owner.login}.github.io/${ghData.name}`
      // handle cases of user.github.io/user.github.io
      if (playableLink.split('/')[0] === playableLink.split('/')[1]) {
        playableLink = `${ghData.owner.login}.github.io`
      }
    }
    console.log({ghData})
    projectRecord = await projectBase.create({
      "Repo": projects[0],
      "Scrapbooks": [scrapbook.id],
      "User": scrapbook.fields["User"],
      "Playable Link": playableLink
    })
  }
  console.log("Created", projectRecord.id)
}

// async function findOrCreateProject(name) {
//   const projectRecords = await projectBase.select({
//     filterByFormula: `{Name} = '${name}'`,
//     maxRecords: 1
//   }).all()
//   let projectRecord = projectRecords[0]
//   if (!projectRecord) {
//     projectRecord = await projectBase.create({
//       "Name": name
//     })
//   }
//   return projectRecord
// }

// // get all records from the base with a filter
// const filter = [
//   `Scrapbook = '${scrapbook.id}'`,
//   "NOT({TEMP: Git commits} = BLANK())",
//   "NOT({TEMP: Git commits} = 'None')",
//   "{Status} = 'Banked'"
// ]

// const sessionRecords = await sessionBase.select({
//   maxRecords: 1,
//   filterByFormula: `AND(${filter.join(',')})`
// }).all()

// const session = sessionRecords[0]
// const projects = findReposInText(session.fields["TEMP: Git commits"])

// projects.forEach(async (project) => {
//   const projectRecords = await projectBase.select({
//     filterByFormula: `{Name} = '${project}'`,
//     maxRecords: 1
//   }).all()

//   const projectRecord = projectRecords[0]
//   if (projectRecord) {
//     await sessionBase.update(session.id, {
//       "Project": [projectRecord.id]
//     })
//   }
// })