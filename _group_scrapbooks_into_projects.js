require("dotenv").config();

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base("app4kCWulfB02bV8Q");

const scrapbookBase = base("Scrapbook");
const sessionBase = base("Sessions");
const projectBase = base("Projects");
const userBase = base("Users");

function findUrlsInText(text, regex) {
  const matches = text.match(regex);
  return matches || [];
}

async function checkUserForFraud(user) {
  const user = await userBase.find(user);
  if (user.fields["Fraud"] == "🚩 Committed Fraud") {
    return true;
  }
}

function findReposInText(text) {
  const commitRegex = new RegExp(
    "https://github.com(?:/[^/]+)*/commit/[0-9a-f]{40}",
    "g"
  );
  const repoRegex = new RegExp("https://github.com/([^/]+)/([^/]+)", "g");
  const prRegex = new RegExp("https://github.com(?:/[^/]+)*/pull/[0-9]+", "g");
  const repoLinks = [
    ...findUrlsInText(text, repoRegex),
    ...findUrlsInText(text, prRegex),
    ...findUrlsInText(text, commitRegex),
  ];

  return unique(repoLinks.map(parseGithubUrl).filter(Boolean));
}

async function findOrCreateProject(name) {
  const projectRecords = await projectBase
    .select({
      filterByFormula: `{Name} = '${name}'`,
      maxRecords: 1,
    })
    .all();
  let projectRecord = projectRecords[0];
  if (!projectRecord) {
    projectRecord = await projectBase.create({
      Name: name,
    });
  }
  return projectRecord;
}

function unique(arr) {
  return [...new Set(arr)];
}

function parseGithubUrl(url) {
  try {
    const u = new URL(url);
    const [_, username, repo] = u.pathname.split("/");
    return `${username}/${repo}`;
  } catch (e) {
    return null;
  }
}

// start the main function

const scrapbooks = await scrapbookBase
  .select({
    filterByFormula: `AND(
      {Linked Sessions Count} > 1,
      {Approved} = TRUE(),
    )`,
  })
  .all();
const scrapbooksWithoutProjects = scrapbooks.filter(
  (scrapbook) => scrapbook.fields["Projects"] == []
);
const scrapbookToConvert =
  scrapbooksWithoutProjects[
    Math.floor(Math.random() * scrapbooksWithoutProjects.length)
  ];
// find a random scrapbook that isn't linked to a project
// find the github repo connected to this scrapbook
// find the user for the scrapbook
// find all the scrapbooks for this user & check if they have the same repo

// find all scrapbooks by this user & test them for this github repo

// find or create a project with this name

// link the project to the scrapbook
