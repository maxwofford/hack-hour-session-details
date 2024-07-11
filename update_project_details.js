require("dotenv").config();

let githubHeaders = {};
let ghTimeout = 5000;
if (process.env.GITHUB_TOKEN) {
  // optionally set a github token to increase rate limit
  // I use a PAT with zero additional scopes (this only makes public API calls)
  githubHeaders = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };

  ghTimeout = 1000;
}

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});

const base = Airtable.base("app4kCWulfB02bV8Q");

const projectsBase = base("Projects");

const projects = await projectsBase
  .select({
    filterByFormula: `{Action: Scrape for project details} = TRUE()`,
  })
  .all();

console.log("Finding more details for ", projects.length, "project(s)");
for (let i = 0; i < projects.length; i++) {
  const project = projects[i];
  console.log(`${i + 1} / ${projects.length}`);
  if (i > 0 && i % 10 === 0) {
    console.log("Sleeping for 20 seconds to avoid rate limit");
    await new Promise((r) => setTimeout(r, 20 * 1000));
  }
  if (i > 0 && i % 100 === 0) {
    console.log("Sleeping for 5 min to avoid rate limit");
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  }
  await Promise.all([
    projectsBase.update(project.id, {
      "Action: Scrape for project details": false,
      Description:
        project.get("Description") || (await getDescription(project.fields["Repo"])),
      "Playable Link":
        project.get("Playable Link") ||
        (await getPlayableLink(project.fields["Repo"])),
      "Screenshot / Video":
        project.get("Screenshot / Video") || (await getScreenshot(project)),
    }),
    new Promise((r) => setTimeout(r, 200)),
  ]);
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

async function getDescription(repoName) {
  console.log({repoName})
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}`,
    githubHeaders
  ).then((r) => r.json());
  console.log({ghData})
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
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}`,
    githubHeaders
  ).then((r) => r.json());
  await new Promise((r) => setTimeout(r, ghTimeout)); // rate limit for gh api
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
    await getReleases(repoName).then((releases) => {
      if (releases.length > 0) {
        playableLink = releases[0].html_url;
        console.log("GH Release found!", playableLink);
      }
    });
  }
  if (!playableLink) {
    await getTags(repoName).then((tags) => {
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
    githubHeaders
  ).then((r) => r.json());
  return ghData;
}

async function getTags(repoName) {
  const ghData = await fetch(
    `https://api.github.com/repos/${repoName}/tags`,
    githubHeaders
  ).then((r) => r.json());
  return ghData;
}
