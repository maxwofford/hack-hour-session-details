require("dotenv").config();

const Airtable = require("airtable");
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY,
});
const base = Airtable.base("app4kCWulfB02bV8Q");

const scrapbookBase = base("Scrapbook");
const sessionBase = base("Sessions");
const chunkSize = 10;

const scrapbooks = await scrapbookBase
  .select({
    filterByFormula: `AND(
    {Linked Sessions Count} > 1,
    NOT({OTJ: Sorted scraps} = TRUE())
  )`,
  })
  .all();

console.log("Found", scrapbooks.length, "scrapbooks to update");
// do in groups of 10
for (let i = 0; i < scrapbooks.length; i += chunkSize) {
  console.log("Processing chunk", i);
  const chunk = scrapbooks.slice(i, i + chunkSize);
  for (const scrapbook of chunk) {
    console.log("Processing scrapbook", scrapbook.id)
    await new Promise((r) => setTimeout(r, 1000));
    const updateJobs = scrapbooks.map(async (scrapbook) => {
      const sessions = await sessionBase
        .select({
          filterByFormula: `{Scrapbook} = '${scrapbook.fields["Scrapbook TS"]}'`,
        })
        .all();

      const sortedSessions = sessions.sort((a, b) => {
        return (
          new Date(a.fields["Created At"]) - new Date(b.fields["Created At"])
        );
      });

      return {
        id: scrapbook.id,
        fields: {
          Sessions: sortedSessions.map((session) => session.id),
          "OTJ: Sorted scraps": true,
        },
      };
    });

    const scrapbooksToUpdate = await Promise.all(updateJobs);

    scrapbooksToUpdate.forEach((scrapbook) =>
      console.log(
        "Just updated scrapbook",
        scrapbook.id,
        "with sorted sessions",
        scrapbook.fields["Sessions"]
      )
    );
    console.log("dryrun")
    // const output = await scrapbookBase.update(scrapbooksToUpdate);
    await new Promise((r) => setTimeout(r, 3000));

  }
}
