const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 10000;
const ROOM_CONCURRENCY = 12;
const TRUSTED_BUILDINGS_PATH = path.join(__dirname, '../../public/buildings_data.json');

function loadTrustedBuildings() {
  try {
    return JSON.parse(fs.readFileSync(TRUSTED_BUILDINGS_PATH, 'utf8'));
  } catch (error) {
    console.error('Failed to load trusted building inventory:', error);
    return [];
  }
}

const TRUSTED_BUILDINGS = loadTrustedBuildings();
const TRUSTED_BUILDINGS_BY_CODE = new Map(
  TRUSTED_BUILDINGS.map((building) => [String(building.code || '').trim(), building])
);

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

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchRoomAvailability(roomId, startDate) {
  const params = new URLSearchParams({
    obj_cache_accl: '0',
    start_dt: `${startDate}T00:00:00`,
    comptype: 'availability_daily',
    compsubject: 'location',
    page_size: '100',
    space_id: String(roomId),
    include: 'closed blackouts pending related empty',
    caller: 'pro-AvailService.getData',
  });

  const url = `https://25live.collegenet.com/25live/data/umd/run/availability/availabilitydata.json?${params.toString()}`;
  const response = await fetchWithTimeout(url, TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const availabilityBySlot = new Map();

  for (const subject of data.subjects || []) {
    const date = subject.item_date || '';
    for (const item of subject.items || []) {
      const timeStart = item.start || 'N/A';
      const timeEnd = item.end || 'N/A';
      const key = `${date}|${timeStart}|${timeEnd}`;

      if (!availabilityBySlot.has(key)) {
        availabilityBySlot.set(key, {
          date,
          event_name: [item.itemName || 'N/A'],
          time_start: timeStart,
          time_end: timeEnd,
          status: item.type_id ?? 'N/A',
          additional_details: [item.itemId2 || 'N/A'],
        });
        continue;
      }

      const entry = availabilityBySlot.get(key);
      entry.event_name.push(item.itemName || 'N/A');
      entry.additional_details.push(item.itemId2 || 'N/A');
    }
  }

  return Array.from(availabilityBySlot.values()).map((entry) => ({
    ...entry,
    event_name: entry.event_name.join(', '),
    additional_details: entry.additional_details.map(String).join(', '),
  }));
}

async function runPool(items, worker, limit) {
  let cursor = 0;

  async function next() {
    if (cursor >= items.length) return;
    const item = items[cursor++];
    await worker(item);
    await next();
  }

  const size = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: size }, () => next()));
}

function isFetchableRoom(room) {
  return Number.isFinite(Number(room?.id)) && !room?.source && !room?.supplemental;
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

  const { date, building } = payload || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return badRequest('Expected date in YYYY-MM-DD format');
  }
  if (!building || typeof building !== 'object') {
    return badRequest('Expected a building payload');
  }
  const buildingCode = String(building.code || '').trim();
  const trustedBuilding = TRUSTED_BUILDINGS_BY_CODE.get(buildingCode);
  if (!trustedBuilding) {
    return badRequest(`Unknown building code: ${buildingCode || 'missing'}`);
  }

  const nextBuilding = {
    ...trustedBuilding,
    classrooms: (trustedBuilding.classrooms || []).map((room) => ({
      ...room,
      availability_times: isFetchableRoom(room)
        ? []
        : Array.isArray(room.availability_times)
        ? room.availability_times
        : [],
    })),
  };
  const fetchableRooms = nextBuilding.classrooms.filter(isFetchableRoom);

  try {
    await runPool(
      fetchableRooms,
      async (room) => {
        room.availability_times = await fetchRoomAvailability(room.id, date);
      },
      ROOM_CONCURRENCY
    );

    return json(200, nextBuilding);
  } catch (error) {
    return json(502, {
      error: `Failed to fetch availability for ${buildingCode || trustedBuilding.name || 'building'}`,
      details: error.message,
    });
  }
};
