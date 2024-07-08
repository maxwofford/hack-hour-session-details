require("dotenv").config();

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});

const base = Airtable.base("app4kCWulfB02bV8Q");

const projectsBase = base("Projects");

const projects = await projectsBase.select({
  filterByFormula: `{Action: Scrape for project details} = TRUE()`,
  maxRecords: 10,
}).all();

for (let i = 0; i < projects.length; i++) {
  const project = projects[i];
  projectsBase.update(project.id, {
    "Action: Scrape for project details": false,
    "Playable Link": project.get("Playable Link") || await getPlayableLink(project.fields["Repo"]),
  });
  await new Promise((r) => setTimeout(r, 2000));
}

async function getPlayableLink(repoName) {
  let playableLink = "";
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}`
  ).then((r) => r.json());
  console.log(ghData)
  if (ghData.has_pages) {
    playableLink = `${ghData.owner.login}.github.io/${ghData.name}`;
    // handle cases of user.github.io/user.github.io
    if (playableLink.split("/")[0] === playableLink.split("/")[1]) {
      playableLink = `${ghData.owner.login}.github.io`;
    }
  }
  if (!playableLink) {
    await getReleases(repoName).then((releases) => {
      if (releases.length > 0) {
        playableLink = releases[0].html_url;
      }
    });
  }

  return playableLink;
}

async function getReleases(repoName) {
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}/releases`
  ).then((r) => r.json());
  return ghData;
}