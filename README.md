# hack-hour-session-details

A set of scripts around filling data for hack hour session details.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.js # this searches slack for each session and finds github repost related to projects
bun run link_scrapbooks_to_projects.js # this finds or creates a project for each repo found
bun run update_project_details.js # this uses heuristics to guess details about the project
```

This project was created using `bun init` in bun v1.1.17. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
