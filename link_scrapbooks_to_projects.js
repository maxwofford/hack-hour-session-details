require("dotenv").config();

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base("app4kCWulfB02bV8Q");

const scrapbookBase = base("Scrapbook");
const projectBase = base("Projects");
const reposBase = base("Repos");

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

async function findOrCreateRepos(arr) {
  const nameFilter = arr.map((name) => `{Name} = '${name}'`).join(", ");
  const formula = arr.length == 1 ? nameFilter : `OR(${nameFilter})`
  let newRepoRecords = [];
  let repoRecords = await reposBase
    .select({
      filterByFormula: formula,
    })
    .all();
  const missingRepos = arr.filter(
    (name) => !repoRecords.some((r) => r.get("Name") === name)
  );
  if (missingRepos.length > 0) {
    console.log("Creating missing repos", missingRepos);
    const newRecordFields = missingRepos.map((name) => ({
      fields: {
        Org: name.split("/")[0],
        "Repo Name": name.split("/")[1],
        "Repo Link": `https://github.com/${name}`
      },
    }));
    newRepoRecords = await reposBase.create( newRecordFields );
  }
  return [...repoRecords, ...newRepoRecords];
}

async function findOrCreateProject(name, scrapbookID, userID, repos) {
  let projectFilter = `{Name} = '${name}'`
  const existingProjectForRepo = repos.map(r => r.get("Projects")).flat().filter(Boolean);
  if (existingProjectForRepo.length > 0) {
    console.log("Project already exists for repo– potential project merge available", name);
    projectFilter = `RECORD_ID() = '${existingProjectForRepo[0]}'`
  }
  const projectRecords = await projectBase
    .select({
      filterByFormula: projectFilter,
      maxRecords: 1,
    })
    .all();
  let projectRecord = projectRecords[0];
  if (projectRecord) {
    console.log("Updating project", name);
    const previousRepoIDs = projectRecord.get("Repos") || [];
    await projectBase.update(projectRecord.id, {
      "Action: Scrape for project details": true,
      Scrapbooks: unique([...projectRecord.get("Scrapbooks"), scrapbookID]),
      Repos: unique([...previousRepoIDs, ...repos.map(r => r.id)]),
      Status: "Pending"
    });
  } else {
    console.log("Creating project", name);
    projectRecord = await projectBase.create({
      "Action: Scrape for project details": true,
      Name: name,
      Repo: name,
      User: [userID],
      Scrapbooks: [scrapbookID],
      Repos: repos.map(r => r.id)
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
let scrapbookRecords = await scrapbookBase
  .select({
    // maxRecords: 10,
    filterByFormula: `AND(${scrapbookFilter.join(",")})`,
    sort: [{ field: "User", direction: "asc" }], // work through the queue by user
  })
  .all();

for (let i = 0; i < scrapbookRecords.length; i++) {
  const scrapbook = scrapbookRecords[i];
  // find all scrapbooks by this user
  const repos = findReposInText(scrapbook.fields["TEMP: Commits"].join("\n"));
  const repoRecords = await findOrCreateRepos(repos);
  if (repoRecords.length > 0) { // handling multiple repos is doable, just need to bind them together going forward
    // are there multiple projects in this 1 repo?
    const reposWithMultipleProjects = repoRecords.filter(r => r.get("Projects") && r.get("Projects").length > 1)
    if (reposWithMultipleProjects.length > 0) {
      console.log("Multiple projects bound to", reposWithMultipleProjects.map(r => r.get("Name")))
      continue
    } else {
      const projectRecord = await findOrCreateProject(
        repoRecords.map(id => id.get("Name")).join(" + "),
        scrapbook.id,
        scrapbook.get("User")[0],
        repoRecords
      );
    }
  }

  await new Promise((r) => setTimeout(r, 3000));
}
