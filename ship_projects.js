import { sleep } from 'bun';

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
const scrapbookBase = base('Scrapbook')

const projectsToShip = await projectsBase.select({
  filterByFormula: `AND({Status} = 'Shipped', {Submission} = BLANK())`,
}).all();

console.log("Shipping", projectsToShip.length, "project(s)");

for (let i = 0; i < projectsToShip.length; i++) {
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
  if (!fields['Playable URL'] && project.get('Scrapbooks').length > 0) {
    let scrapbook = await scrapbookBase.find(project.get('Scrapbooks')[0])
    fields['Playable URL'] = scrapbook.get('Scrapbook URL')
  }
  fields['Override Hours Spent'] = project.get('Total Project Time') / 60 / 60
  fields['GitHub Username'] = project.get('Repo').split('/')[0]
  fields['Screenshot'] = (project.get('Screenshot / Video') || []).map(s => ({
    url: s.url,
    filename: s.filename
  }))

  fields['Override Hours Spent Justification'] = `This is the number of hours
  tracked by Manitej's bot in #arcade on Slack.  It was built over
  ${project.get('Scrapbook Links').length} scrapbook update(s).
  ${project.get('Scrapbook Links').map(m => '-' + m).join('\n')}`

  const user = await getUser(project.get('User'))
  fields['Email'] = user.get('Email')

  if (!user.get('YSWS Verification User')) {
    console.error("No verification on user!", user.id)
    continue
  }
  const verification = await getVerification(user.get('YSWS Verification User'))
  fields['Birthday'] = verification.get('Birthday')
  fields['First Name'] = verification.get('Name').split(' ')[0]
  fields['Last Name'] = verification.get('Name').split(' ').slice(1).join(' ')

  if (!user.get('Orders') || user.get('Orders').length == 0) {
    console.error("No orders on user!", user.id)
    continue
  }
  const order = await getOrder(user.get('Name'))
  if (!order) {
    console.error("No order found!")
    continue
  }

  fields['First Name'] ||= order.get('Shipping – First Name') || user.get('Name').split(' ')[0]
  fields['Last Name'] ||= order.get('Shipping – Last Name') || user.get('Name').split(' ').slice(1).join(' ')
  fields['Address (Line 1)'] = order.get('Address: Line 1')
  fields['Address (Line 2)'] = order.get('Address: Line 2')
  fields['City'] = order.get('Address: City')
  fields['ZIP / Postal Code'] = order.get('Address: Postal Code')
  fields['State / Province'] = order.get('Address: State/Province')
  fields['Country'] = order.get('Address: Country')

  console.log(fields)
  console.log('creating submission')
  try {

  await submissionsBase.create(fields)
  } catch (e) {
    console.log(e)
  }
  sleep(10 * 1000)
}

async function getUser(recordID) {
  return await usersBase.find(recordID)
}

async function getOrder(recordID) {
  console.log("Getting order for", recordID)
  const orders = await ordersBase.select({
    filterByFormula: `AND(
    {Status} = 'Fulfilled',
    NOT(BLANK() = {Address: Line 1}),
    {User} = "${recordID}"
    )`
  }).all()
  return orders[0]
}

async function getVerification(recordID) {
  return await verificationsBase.find(recordID)
}