import { sleep } from "bun";

const { scrapbookBase, usersBase, reposBase, projectBase, ratelimiter } =
  require("./lib/airtable").default;
const uniq = require("./lib/uniq").default;

// console.log("Fetching all sessions")
// const allSessions = await sessionBase.select().all();
// console.log("Fetching all scrapbooks")
// const allScrapbookRecords = await scrapbookBase.select().all();
// console.log("Fetching all users")
// const allUserRecords = await usersBase.select().all();
// console.log("Fetching all repos")
// const allRepoRecords = await reposBase.select().all();
// console.log("Fetching all projects")
// const allProjectRecords = await projectBase.select().all();

// Find every "ship" scrapbook that doesn't currently have a linked project
const scrapbookFilter = [
  "{Projects} = BLANK()",
  "OR({Update type} = 'Ship', {Is Shipped?} = TRUE())",
  "Approved = TRUE()",
  "NOT({Session Commits} = BLANK())",
];

const scrapbooks = await scrapbookBase
  .select({
    filterByFormula: `AND(${scrapbookFilter.join(",")})`,
    // maxRecords: 1,
    order: [{ field: "Scrapbook TS", direction: "asc" }],
  })
  .all();

console.log("Found", scrapbooks.length, "scrapbooks to process");
for (let i = 0; i < scrapbooks.length; i++) {
  const ship = scrapbooks[i];

  if (!ship) {
    console.log("No scrapbooks to process");
    process.exit(0);
  }

  console.log("Processing scrapbook", ship.id);
  const user = await usersBase.find(ship.get("User"));
  if (user.get("Fraud Formula") != "✅ Didn't Commit Fraud") {
    console.log("User has a fraud, skipping", user.id);
    continue;
  }
  // get all scrapbooks by user up to this point
  const scrapbooksBeforeShip = await scrapbookBase
    .select({
      filterByFormula: `AND({User} = '${user.get(
        "Name"
      )}', {Projects} = BLANK(), Approved = TRUE(), {Linked Sessions Count} > 0)`,
      sort: [{ field: "Scrapbook TS", direction: "asc" }],
    })
    .all();
  console.log(
    "Found ",
    scrapbooksBeforeShip.length,
    "scrapbooks by user",
    user.get("Name")
  );

  // find or create the github repo for each scrapbook
  let projectsToCreate = [];
  let hasIssues = false;
  for (const scrapbook of scrapbooksBeforeShip) {
    console.log("Processing scrapbook", scrapbook.id);
    const sessionText = scrapbook.fields["Session Commits"] || [];
    const scrapbookText = scrapbook.fields["Text"];
    const repos = findReposInText([...sessionText, scrapbookText].join("\n"));
    const repoRecords = await findOrCreateRepos(repos);
    if (repoRecords.length > 0) {
      // handling multiple repos is doable, just need to bind them together going forward
      // are there multiple projects in this 1 repo?
      const reposWithMultipleProjects = repoRecords.filter(
        (r) => r.get("Projects") && r.get("Projects").length > 1
      );
      if (reposWithMultipleProjects.length > 0) {
        console.log(
          "Multiple projects bound to",
          reposWithMultipleProjects.map((r) => r.get("Name"))
        );
        continue;
      } else {
        projectsToCreate.push({
          repos: repoRecords.map((id) => id.get("Name")).join(" + "),
          scrapbooks: scrapbook.id,
          users: scrapbook.get("User")[0],
          repoRecords: repoRecords,
        });
      }
    } else {
      console.log("No repo found for", scrapbook.id)
      hasIssues = true;
    }
  }
  if (hasIssues) {
    console.log("Some projects have issues, skipping this user");
  } else {
    for (const project of projectsToCreate) {
      await findOrCreateProject(
        project.repos,
        project.scrapbooks,
        project.users,
        project.repoRecords
      );
    }
    await sleep(5 * 1000);
    if (scrapbooksBeforeShip.length > 0) {
      // prompt('[Press any key to continue]')
    }
  }
}

// utils

async function findOrCreateRepos(arr) {
  const nameFilter = arr.map((name) => `{Name} = '${name}'`).join(", ");
  const formula = arr.length == 1 ? nameFilter : `OR(${nameFilter})`;
  let newRepoRecords = [];
  let repoRecords = await ratelimiter.schedule(() => reposBase
    .select({
      filterByFormula: formula,
    })
    .all())
  const missingRepos = arr.filter(
    (name) => !repoRecords.some((r) => r.get("Name") === name)
  );
  if (missingRepos.length > 0) {
    console.log("Creating missing repos", missingRepos);
  }
  for (let i = 0; i < missingRepos.length; i += 10) {
    const repoChunk = missingRepos.slice(i, i + 10).filter(Boolean);
    console.log("Batching", repoChunk)
    const newRecordFields = repoChunk.map((name) => ({
      fields: {
        Org: name.split("/")[0],
        "Repo Name": name.split("/")[1],
        "Repo Link": `https://github.com/${name}`,
      },
    }));
    newRepoRecords.concat(await ratelimiter.schedule(() => reposBase.create(newRecordFields)))
  }
  return [...repoRecords, ...newRepoRecords];
}

async function findOrCreateProject(name, scrapbookID, userID, repos) {
  let projectFilter = `{Name} = '${name}'`;
  const existingProjectForRepo = repos
    .map((r) => r.get("Projects"))
    .flat()
    .filter(Boolean);
  if (existingProjectForRepo.length > 0) {
    console.log(
      "Project already exists for repo– potential project merge available",
      name
    );
    projectFilter = `RECORD_ID() = '${existingProjectForRepo[0]}'`;
  }
  const projectRecords = await ratelimiter.schedule(() => projectBase
    .select({
      filterByFormula: projectFilter,
      maxRecords: 1,
    })
    .all())
  let projectRecord = projectRecords[0];
  if (projectRecord) {
    console.log("Updating project", name);
    const previousRepoIDs = projectRecord.get("Repos") || [];
    await projectBase.update(projectRecord.id, {
      "Action: Scrape for project details": true,
      Scrapbooks: uniq([...projectRecord.get("Scrapbooks"), scrapbookID]),
      Repos: uniq([...previousRepoIDs, ...repos.map((r) => r.id)]),
      // Status: "Pending"
    });
  } else {
    console.log("Creating project", name);
    projectRecord = await ratelimiter.schedule(() => projectBase.create({
      "Action: Scrape for project details": true,
      Name: name,
      Repo: name,
      User: [userID],
      Scrapbooks: [scrapbookID],
      Repos: repos.map((r) => r.id),
    }))
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
  const repoRegex = /https:\/\/github\.com\/[\w\-\/]+/g;
  const prRegex = new RegExp("https://github.com(?:/[^/]+)*/pull/[0-9]+", "g");
  try {
    const repoLinks = [
      ...findUrlsInText(decodeURI(text), repoRegex),
      ...findUrlsInText(decodeURI(text), prRegex),
      ...findUrlsInText(decodeURI(text), commitRegex),
    ];

    return uniq(repoLinks.map(parseGithubUrl).filter(Boolean));
  } catch (e) {
    console.log(e);
    return [];
  }
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
