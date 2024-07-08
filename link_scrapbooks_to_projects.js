require("dotenv").config();

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base("app4kCWulfB02bV8Q");

const scrapbookBase = base("Scrapbook");
const projectBase = base("Projects");

function findUrlsInText(text, regex) {
  const matches = text.match(regex);
  return matches || [];
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

async function findOrCreateProject(name, scrapbookID, userID) {
  const projectRecords = await projectBase
    .select({
      filterByFormula: `{Name} = '${name}'`,
      maxRecords: 1,
    })
    .all();
  let projectRecord = projectRecords[0];
  if (projectRecord) {
    console.log("Updating project", name)
    await projectBase.update(projectRecord.id, {
      "Action: Scrape for project details": true,
      Scrapbooks: unique([...projectRecord.get("Scrapbooks"), scrapbookID]),
    })
  } else {
    console.log("Creating project", name)
    projectRecord = await projectBase.create({
      "Action: Scrape for project details": true,
      Name: name,
      Repo: name,
      User: [userID],
      Scrapbooks: [scrapbookID]
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

// main function

const scrapbookFilter = [
  "Approved = TRUE()",
  "{Linked Sessions Count} > 0",
  "NOT({TEMP: Commits} = BLANK())",
  "{Projects} = BLANK()",
];
const scrapbookRecords = await scrapbookBase
  .select({
    filterByFormula: `AND(${scrapbookFilter.join(",")})`,
  })
  .all();

for (let i = 0; i < scrapbookRecords.length; i++) {
  const scrapbook = scrapbookRecords[i];
  // find all scrapbooks by this user
  const projects = findReposInText(
    scrapbook.fields["TEMP: Commits"].join("\n")
  );
  if (projects.length > 1) {
    // uh oh...
    // TODO: Figure out how to handle this edgecase
    console.log("Multiple projects found...");
    console.log(projects);
    console.log("Skipping!");
    continue;
  } else if (projects.length === 1) {
    const projectRecord = await findOrCreateProject(projects[0], scrapbook.id, scrapbook.get("User")[0]);
  } else {
    console.log("No projects found for scrapbook", scrapbook.id);
  }

  await new Promise((r) => setTimeout(r, 3000));
}