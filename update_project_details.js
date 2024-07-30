const airtableRatelimiter = require("./lib/airtable").default.ratelimiter;
const githubRatelimiter = require("./lib/github").default.ratelimiter
const githubHeaders = require("./lib/github").default.headers
const imgbbRatelimiter = require("./lib/imgbb").default.ratelimiter
import { sleep } from "bun";

let ghCache = new Map();

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
        (await getPlayableLinkFromGH(project.fields["Repo"])) ||
        (await getPlayableLinkFromScrapbook(project.fields["Scrapbooks"])),
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
  try {

    const scrapbooks = await airtableRatelimiter.schedule(() => base("Scrapbook")
      .select({
        filterByFormula: `{Projects} = '${projectRecord.fields["Name"]}'`,
      })
      .all())

    const scrapbookFiles = scrapbooks[0].fields["Attachments"].map((obj) => ({
      url: obj.url,
      filename: obj.filename,
    }));

    const videoFiles = scrapbookFiles.filter((file) =>
      file.filename.includes(".mp4")
    );

    let thumbnails = [];
    for (const file of videoFiles) {
      try {
        const { getVideoDurationInSeconds } = require("get-video-duration");
        const seekTime =
          Math.min(await getVideoDurationInSeconds(file.url), 60) / 2;

        const genThumbnail = require("simple-thumbnail");

        const _thumbnail = await genThumbnail(file.url, "./tmp/thumb.png", "500x?", {
          seek: `00:00:${seekTime.toString().padStart(2, "0")}`,
        });

        const imgbbUploader = require("imgbb-uploader");
        const thumbUrl = await imgbbRatelimiter.schedule(() => imgbbUploader(
          process.env.IMGBB_API_KEY,
          "./tmp/thumb.png"
        )
          .then((response) => response.url)
          .catch((error) => console.error(error)))

        thumbnails.push({
          filename: file.filename + ".png",
          url: thumbUrl,
        });
      } catch(e) {
        console.error(e)
      }
    }
    return [...thumbnails, ...scrapbookFiles];
  } catch(e) {
    console.error(e)
  }
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
  console.log("No description found in repos")
  if (!process.env.OPENAI_API_KEY) {return}
  console.log("Attempting to download READMEs and generate descriptions")
  for (let i = 0; i < repos.length; i++) {
    // get README from description
    const repo = repos[i];
    const readme = await fetch(`https://api.github.com/repos/${repo}/readme`, { headers: githubHeaders }).then(r => r.json())
    const readmeURL = readme?.download_url
    if (!readmeURL) { continue }
    const readmeContent = await fetch(readmeURL).then(r => r.text())
    if (readmeContent.length < 180) {
      console.log("Readme is short!")
      return readmeContent
    }
    if (!readmeContent) { continue }
    const OpenAI = require('openai');
    const client = new OpenAI()
    const prompt = `You are helping me analyze GitHub repos made by high schoolers working on a summer program. Please respond in a short, concise manner.
    If you can't find a description, or the description is too generic to assume what the code does, please respond with "NO DESCRIPTION FOUND" or "DESCRIPTION IS TOO GENERIC".
    Generate a description for the GitHub repo '${repo}' based on the following README file content: \n\n${readmeContent}`
    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-3.5-turbo',
    })
    return `${chatCompletion.choices[0].message.content}
    - description by gpt using max's script`
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

async function getPlayableLinkFromGH(repoName) {
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
  if (ghData.homepage  && !ghData.homepage.includes('replit') && !playableLink) {
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
  if (!playableLink) {
    console.log("No playable link found in github")
  }

  return playableLink;
}

async function getPlayableLinkFromScrapbook(scrapbooks = []) {
  if (scrapbooks.length == 0) { return }
  let search
  if (scrapbooks.length == 1) {
    search = () => base("Scrapbook").find(scrapbooks[0]).then(r => [r])
  } else {
    search = () => base("Scrapbook").select({
      filterByFormula: `OR(${scrapbooks.map(m => `{Scrapbook TS} = '${m}'`).join(", ")})`
    }).all()
  }

  const scrapbookRecords = await airtableRatelimiter.schedule(search);

  const allLinks = scrapbookRecords.map((record) => record.fields["Session Links"]).flat().filter(Boolean);

  const shippingWebsites = ['itch.io', 'printables.com', 'glitch.me', 'vercel.app']

  for (const link of allLinks) {
    if (shippingWebsites.some((site) => link.includes(site))) {
      return link;
    }
  }
  console.log("No playable link found in scrapbook");
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
