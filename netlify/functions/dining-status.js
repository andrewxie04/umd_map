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
    latitude: 38.9927771,
    longitude: -76.9496139,
  },
];

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
    dateKey: hall.dateKey,
    meals,
    pageUrl: `${DINING_BASE_URL}/location.aspx?locationNum=${hall.locationNum}&dtdate=${encodeURIComponent(hall.dtdate)}`,
  };
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
    const halls = await Promise.all(
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
    );

    return json(200, { halls, date: dateKey });
  } catch (error) {
    return json(502, {
      error: 'Failed to fetch dining hall information',
      details: error.message,
    });
  }
};
