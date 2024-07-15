const { scrapbookBase, usersBase, reposBase, projectBase } = require("./lib/airtable").default;
const uniq = require("./lib/uniq").default;



// Find every "ship" scrapbook that doesn't currently have a linked project
const scrapbookFilter = [
  "{Projects} = BLANK()",
  "{Update type} = 'Ship'",
  "Approved = TRUE()",
];

const scrapbooks = await scrapbookBase.select({
  filterByFormula: `AND(${scrapbookFilter.join(",")})`,
  maxRecords: 1,
  order: [{ field: "Scrapbook TS", direction: "asc" }]
}).all();
const ship = scrapbooks[0];

if (!ship) {
  console.log("No scrapbooks to process");
  process.exit(0);
}

console.log("Processing scrapbook", ship.id);
const user = await usersBase.find(ship.get("User"));
// get all scrapbooks by user up to this point
const scrapbooksBeforeShip = await scrapbookBase.select({
  filterByFormula: `AND({User} = '${user.get('Name')}', {Projects} = BLANK(), Approved = TRUE())`,
  sort: [{ field: "Scrapbook TS", direction: "asc" }]
}).all();
console.log("Found ", scrapbooksBeforeShip.length, "scrapbooks by user", user.get("Name"));

// find or create the github repo for each scrapbook
for (const scrapbook of scrapbooksBeforeShip) {
  const repos = findReposInText((scrapbook.fields["TEMP: Commits"] || []).join("\n"));
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
  } else {
    console.log("I need help with this one", scrapbook.id)
  }
}





// utils

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
      Scrapbooks: uniq([...projectRecord.get("Scrapbooks"), scrapbookID]),
      Repos: uniq([...previousRepoIDs, ...repos.map(r => r.id)]),
      // Status: "Pending"
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

  return uniq(repoLinks.map(parseGithubUrl).filter(Boolean));
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
