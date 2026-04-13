if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File extends Blob {
    constructor(parts = [], name = '', options = {}) {
      super(parts, options);
      this.name = String(name);
      this.lastModified = options.lastModified ?? Date.now();
    }
  };
}

const cheerio = require('cheerio');

const DINING_BASE_URL = 'https://nutrition.umd.edu';
const REQUEST_TIMEOUT_MS = 15000;
const MARKETS_AND_SHOPS_PAGE_URL = 'https://dining.umd.edu/hours-locations/markets-and-shops';
const MARKETS_AND_SHOPS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1vdWskGO2-aJfKLSW8-3zMaj_nx4SBJHF3OvMEy4-ZNo/gviz/tq?gid=1618091201';

const DINING_HALLS = [
  {
    id: 'south-campus',
    locationNum: '16',
    name: 'South Campus Dining Hall',
    shortName: 'South Campus',
    latitude: 38.9830927,
    longitude: -76.9436838,
  },
  {
    id: 'yahentamitsi',
    locationNum: '19',
    name: 'Yahentamitsi Dining Hall',
    shortName: 'Yahentamitsi',
    latitude: 38.9910027,
    longitude: -76.9447406,
  },
  {
    id: '251-north',
    locationNum: '51',
    name: '251 North Dining Hall',
    shortName: '251 North',
    latitude: 38.99269227236477,
    longitude: -76.94980188226687,
  },
];

const RETAIL_DINING_VENUES = [
  {
    id: 'north-campus-market',
    name: 'North Campus Market',
    shortName: 'North Campus Market',
    latitude: 38.992307899557936,
    longitude: -76.94678097392445,
    description: 'Market, cafe, grill, and pizza near Ellicott on north campus.',
    paymentNote: 'Accepts cash, credit/debit, Dining Dollars, and Terrapin Express.',
  },
  {
    id: 'south-campus-market',
    name: 'South Campus Market',
    shortName: 'South Campus Market',
    latitude: 38.9830927,
    longitude: -76.9436838,
    displayLatitude: 38.98284,
    displayLongitude: -76.94408,
    description: 'Shop, cafe, and grill on South Hill near South Campus Dining Hall.',
    paymentNote: 'Accepts cash, credit/debit, Dining Dollars, and Terrapin Express.',
  },
  {
    id: 'union-shop',
    name: 'Union Shop',
    shortName: 'Union Shop',
    latitude: 38.98788564446446,
    longitude: -76.94431974363093,
    description: 'Convenience shop inside Adele H. Stamp Student Union.',
    paymentNote: 'Accepts cash, credit/debit, Dining Dollars, and Terrapin Express.',
  },
  {
    id: 'engage',
    name: 'Engage',
    shortName: 'Engage',
    latitude: 38.986699,
    longitude: -76.941914,
    description: 'Retail dining inside Edward St. John Learning & Teaching Center.',
    paymentNote: 'Cashless; accepts credit/debit, Dining Dollars, and Terrapin Express.',
  },
];

const RETAIL_ROW_TO_VENUE_ID = {
  'North Campus Market': 'north-campus-market',
  'South Campus Market': 'south-campus-market',
  'Union Shop': 'union-shop',
  Engage: 'engage',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function badRequest(message) {
  return json(400, { error: message });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'umdrooms-netlify',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseDateToNutritionFormat(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error('Expected date in YYYY-MM-DD format');
  }
  return `${month}/${day}/${year}`;
}

function absoluteUrl(path) {
  if (!path) return null;
  return new URL(path, DINING_BASE_URL).toString();
}

function parseMealPane(pane, mealName) {
  const sections = [];

  pane.find('.card').each((_, cardEl) => {
    const card = cheerio.load(cardEl);
    const sectionName = card('.card-title').first().text().trim() || mealName;
    const items = [];

    card('.menu-item-name').each((__, itemEl) => {
      const item = card(itemEl);
      const label = item.text().trim();
      if (!label) return;
      items.push({
        name: label,
        url: absoluteUrl(item.attr('href')),
      });
    });

    if (items.length) {
      sections.push({
        name: sectionName,
        items,
      });
    }
  });

  return {
    name: mealName,
    sections,
    items: sections.flatMap((section) => section.items),
  };
}

function parseDiningPage(html, hall) {
  const $ = cheerio.load(html);
  const tabs = $('.nav-tabs .nav-link');
  const meals = [];

  tabs.each((index, tabEl) => {
    const tab = $(tabEl);
    const mealName = tab.text().trim();
    const paneId = tab.attr('href');
    if (!mealName || !paneId?.startsWith('#')) return;

    const pane = $(paneId);
    if (!pane.length) return;

    const parsedMeal = parseMealPane(pane, mealName);
    if (parsedMeal.items.length > 0) {
      meals.push(parsedMeal);
    }
  });

  return {
    ...hall,
    kind: 'hall',
    dateKey: hall.dateKey,
    meals,
    pageUrl: `${DINING_BASE_URL}/location.aspx?locationNum=${hall.locationNum}&dtdate=${encodeURIComponent(hall.dtdate)}`,
  };
}

function parseGvizPayload(text) {
  const startIndex = text.indexOf('{');
  const endIndex = text.lastIndexOf('}');
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Could not parse markets and shops data.');
  }
  return JSON.parse(text.slice(startIndex, endIndex + 1));
}

function normalizeSheetCell(cell) {
  if (!cell) return '';
  return String(cell.v ?? cell.f ?? '').trim();
}

function parseRetailDiningVenues(payload, dateKey) {
  const rows = payload?.table?.rows || [];
  if (!rows.length) return [];

  const headerRow = rows[0]?.c || [];
  const targetDate = parseDateToNutritionFormat(dateKey);
  const dateIndex = headerRow.findIndex((cell) => normalizeSheetCell(cell) === targetDate);
  if (dateIndex === -1) {
    return RETAIL_DINING_VENUES.map((venue) => ({
      ...venue,
      kind: 'retail',
      dateKey,
      pageUrl: MARKETS_AND_SHOPS_PAGE_URL,
      subvenues: [],
    }));
  }

  const grouped = new Map(
    RETAIL_DINING_VENUES.map((venue) => [venue.id, { ...venue, kind: 'retail', dateKey, pageUrl: MARKETS_AND_SHOPS_PAGE_URL, subvenues: [] }])
  );

  rows.slice(1).forEach((row) => {
    const cells = row.c || [];
    const venueLabel = normalizeSheetCell(cells[0]);
    if (!venueLabel) return;

    const [baseName, childName] = venueLabel.split('|').map((part) => part.trim());
    const venueId = RETAIL_ROW_TO_VENUE_ID[baseName];
    if (!venueId || !grouped.has(venueId)) return;

    const hoursLabel = normalizeSheetCell(cells[dateIndex]);
    grouped.get(venueId).subvenues.push({
      id: `${venueId}-${(childName || baseName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: childName || baseName,
      hoursLabel: hoursLabel || 'Closed',
    });
  });

  return Array.from(grouped.values()).map((venue) => ({
    ...venue,
    subvenues: venue.subvenues.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return badRequest('Invalid JSON body');
  }

  const dateKey = String(payload?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return badRequest('Expected date in YYYY-MM-DD format');
  }

  const dtdate = parseDateToNutritionFormat(dateKey);

  try {
    const [halls, retailSheetResponse] = await Promise.all([
      Promise.all(
        DINING_HALLS.map(async (hall) => {
          const url = `${DINING_BASE_URL}/location.aspx?locationNum=${hall.locationNum}&dtdate=${encodeURIComponent(dtdate)}`;
          const response = await fetchWithTimeout(url);
          if (!response.ok) {
            throw new Error(`Dining page returned HTTP ${response.status}`);
          }
          const html = await response.text();
          return parseDiningPage(html, {
            ...hall,
            dtdate,
            dateKey,
          });
        })
      ),
      fetchWithTimeout(MARKETS_AND_SHOPS_SHEET_URL),
    ]);

    if (!retailSheetResponse.ok) {
      throw new Error(`Markets and shops sheet returned HTTP ${retailSheetResponse.status}`);
    }

    const retailSheetText = await retailSheetResponse.text();
    const retailVenues = parseRetailDiningVenues(parseGvizPayload(retailSheetText), dateKey);

    return json(200, { halls, retailVenues, date: dateKey });
  } catch (error) {
    return json(502, {
      error: 'Failed to fetch dining hall information',
      details: error.message,
    });
  }
};
