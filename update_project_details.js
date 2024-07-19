import Bottleneck from "bottleneck";
const airtableRatelimiter = require("./lib/airtable").default.ratelimiter;
import { sleep } from "bun";

require("dotenv").config();

let githubHeaders = {};
if (process.env.GITHUB_TOKEN) {
  // optionally set a github token to increase rate limit
  // I use a PAT with zero additional scopes (this only makes public API calls)
  githubHeaders = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };
}

let ghCache = new Map();

// const airtableRatelimiter = new Bottleneck({
//   // sane defaults
//   maxConcurrent: 2,
//   minTime: 100,
//   // additional resevior logic based on airtables's docs
//   reservoir: 10,
//   reservoirRefreshAmount: 50,
//   reservoirRefreshInterval: 60 * 1000,
// })

const githubRatelimiter = new Bottleneck({
  // sane defaults
  concurrent: 2,
  minTime: 5 * 1000,
  // additional resevior logic based on github's docs
  reservoir: 10,
  reservoirIncreaseAmount: 10,
  reservoirIncreaseInterval: 60 * 1000,
})

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});

const base = Airtable.base("app4kCWulfB02bV8Q");

const projectsBase = base("Projects");

const projects = await airtableRatelimiter.schedule(() => projectsBase
  .select({
    filterByFormula: `{Action: Scrape for project details} = TRUE()`,
  })
  .all())

console.log("Finding more details for ", projects.length, "project(s)");
for (let i = 0; i < projects.length; i++) {
  const project = projects[i];
  console.log(`${i + 1} / ${projects.length}`);
  await Promise.all([
    projectsBase.update(project.id, {
      "Action: Scrape for project details": false,
      Description:
        project.get("Description") || (await getDescriptionFromRepos(project.fields["Repo"].split('+'))),
      "Playable Link":
        project.get("Playable Link") ||
        (await getPlayableLink(project.fields["Repo"])),
      "Screenshot / Video":
        project.get("Screenshot / Video") || (await getScreenshot(project)),
    }),
    new Promise((r) => setTimeout(r, 200)),
  ]);
}
if (projects.length == 0) {
  await sleep(5 * 1000)
}

async function getScreenshot(projectRecord) {
  const scrapbooks = await base("Scrapbook")
    .select({
      filterByFormula: `{Projects} = '${projectRecord.fields["Name"]}'`,
    })
    .all();

  const scrapbookFiles = scrapbooks[0].fields["Attachments"].map((obj) => ({
    url: obj.url,
    filename: obj.filename,
  }));

  const videoFiles = scrapbookFiles.filter((file) =>
    file.filename.includes(".mp4")
  );

  let thumbnails = [];
  for (const file of videoFiles) {
    const { getVideoDurationInSeconds } = require("get-video-duration");
    const seekTime =
      Math.min(await getVideoDurationInSeconds(file.url), 60) / 2;

    const genThumbnail = require("simple-thumbnail");

    const thumbnail = await genThumbnail(file.url, "./tmp/thumb.png", "500x?", {
      seek: `00:00:${seekTime.toString().padStart(2, "0")}`,
    });

    const imgbbUploader = require("imgbb-uploader");
    const thumbUrl = await imgbbUploader(
      process.env.IMGBB_API_KEY,
      "./tmp/thumb.png"
    )
      .then((response) => response.url)
      .catch((error) => console.error(error));

    thumbnails.push({
      filename: file.filename + ".png",
      url: thumbUrl,
    });
  }
  return [...thumbnails, ...scrapbookFiles];
}

async function getDescriptionFromRepos(repos) {
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    console.log(`Getting description for ${repo}`);
    const description = await getDescription(repo.trim());
    if (description) {
      return description;
    }
  }
}

async function fetchGhRepo(repoName) {
  return githubRatelimiter.schedule(() => fetch('https://api.github.com/repos/' + repoName, { headers: githubHeaders} ).then(r => r.json()))
}
async function getGhData(repoName) {
  if (ghCache.has(repoName)) {
    return await ghCache.get(repoName)
  }
  ghCache.set(repoName, fetchGhRepo(repoName))
  return await ghCache.get(repoName)
}

async function getDescription(repoName) {
  console.log("Getting description for", repoName)
  const ghData = await getGhData(repoName);
  if (ghData?.message?.includes('API rate limit exceeded')) {
    console.log('Rate limit exceeded')
    await sleep(10 * 1000)
    process.exit(1)
  }
  if (ghData.description) {
    return ghData.description;
  }
}

async function getPlayableLink(repoName) {
  let playableLink = "";
  try {
    const [org, repo] = repoName.split("/");
    if (repo.includes(org)) {
      await fetch(`https://${repo}`).then((r) => {
        if (r.status === 200) {
          playableLink = `https://${repo}`;
        }
      });
    }
  } catch (e) {
    // Ignore this error– probably means that link doesn't end up going anywhere
  }
  const ghData = await getGhData(repoName)
  if (ghData.homepage && !playableLink) {
    console.log("Homepage found!", ghData.homepage);
    playableLink = ghData.homepage;
  }
  if (ghData.has_pages && !playableLink) {
    playableLink = `${ghData.owner.login}.github.io/${ghData.name}`;
    // handle cases of user.github.io/user.github.io
    if (playableLink.split("/")[0] === playableLink.split("/")[1]) {
      playableLink = `${ghData.owner.login}.github.io`;
    }
    console.log("GH Page found!", playableLink);
  }
  if (!playableLink) {
    await githubRatelimiter.schedule(() => getReleases(repoName)).then((releases) => {
      if (releases.length > 0) {
        playableLink = releases[0].html_url;
        console.log("GH Release found!", playableLink);
      }
    });
  }
  if (!playableLink) {
    await githubRatelimiter.schedule(() => getTags(repoName)).then((tags) => {
      if (tags.length > 0) {
        playableLink = `https://github.com/${repoName}/releases/tag/${tags[0].name}`;
        console.log("GH Tag found!", playableLink);
      }
    });
  }

  return playableLink;
}

async function getReleases(repoName) {
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}/releases`,
    { headers: githubHeaders} 
  ).then((r) => r.json());
  return ghData;
}

async function getTags(repoName) {
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}/tags`,
    { headers: githubHeaders} 
  ).then((r) => r.json());
  return ghData;
}
