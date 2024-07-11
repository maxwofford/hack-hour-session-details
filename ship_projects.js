const airtableBaseID = "app4kCWulfB02bV8Q"

require('dotenv').config()

const Airtable = require('airtable');

Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
})

const base = Airtable.base(airtableBaseID);

const projectsBase = base('Projects');
const usersBase = base('Users');
const submissionsBase = base('Unified YSWS DB Submission')
const ordersBase = base('Orders')
const verificationsBase = base('YSWS Verification Users')

const projectsToShip = await projectsBase.select({
  filterByFormula: `AND({Status} = 'Shipped', {Submission} = BLANK())`,
}).all();

console.log("Shipping", projectsToShip.length, "project(s)");

for (let i = 0; i < projectsToShip.length; i++) {
  if (i > 0) { continue }
  const project = projectsToShip[i];
  console.log(`${i + 1} / ${projectsToShip.length}`);

  let fields = {
    'First Name': '',
    'Last Name': '',
    'Email': '',
    'Playable URL': '',
    'Code URL': '',
    'Screenshot': '',
    'Description': '',
    'GitHub Username': '',
    'Address (Line 1)': '',
    'Address (Line 2)': '',
    'City': '',
    'State / Province': '',
    'Country': '',
    'ZIP / Postal Code': '',
    'Birthday': new Date(),
    'Override Hours Spent': 0.0,
    'Override Hours Spent Justification': '',
    'Projects': [project.id]
  }

  fields['Description'] = project.get('Description')
  fields['Code URL'] = project.get('Github Link')[0]
  fields['Playable URL'] = project.get('Playable Link')
  fields['Override Hours Spent'] = project.get('Total Project Time') / 60 / 60
  fields['GitHub Username'] = project.get('Repo').split('/')[0]
  fields['Screenshot'] = project.get('Screenshot / Video').map(s => ({
    url: s.url,
    filename: s.filename
  }))
  fields['Override Hours Spent Justification'] = `This is the number of hours tracked by Manitej's bot in #arcade on Slack. Numbers verified by the #arcade review team.`

  const user = await getUser(project.get('User'))
  fields['Email'] = user.get('Email')
  if (!user.get('Orders') || user.get('Orders').length == 0) {
    throw new Error("No orders on user!")
  }
  const order = await getOrder(user.get('Orders')[0])

  fields['First Name'] = order.get('Shipping – First Name')
  fields['Last Name'] = order.get('Shipping – Last Name')
  fields['Address (Line 1)'] = order.get('Address: Line 1')
  fields['Address (Line 2)'] = order.get('Address: Line 2')
  fields['City'] = order.get('Address: City')
  fields['ZIP / Postal Code'] = order.get('Address: Postal Code')
  fields['State / Province'] = order.get('Address: State/Province')
  fields['Country'] = order.get('Address: Country')

  if (!user.get('YSWS Verification User')) {
    throw new Error("No verification on user")
  }
  const verification = await getVerification(user.get('YSWS Verification User'))
  fields['Birthday'] = verification.get('Birthday')

  console.log(fields)
  console.log('creating submission')
  try {

  await submissionsBase.create(fields)
  } catch (e) {
    console.log(e)
  }
}

async function getUser(recordID) {
  return await usersBase.find(recordID)
}

async function getOrder(recordID) {
  return await ordersBase.find(recordID)
}

async function getVerification(recordID) {
  return await verificationsBase.find(recordID)
}