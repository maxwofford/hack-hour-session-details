import { file } from "bun";

export default async function cacheAllRecords({ baseName }) {
  const airtable = require("./airtable").default;
  let values = file(`./tmp/${baseName}.json`, { type: "application/json" })
  const exists = await notreal.exists();
  const base = airtable[`${baseName}Base`]
  const records = await base.select().all();
}


function cacheName(model) {
  return `${model.name}_cache.json`;
}
