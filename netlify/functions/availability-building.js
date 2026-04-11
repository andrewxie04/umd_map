const TIMEOUT_MS = 10000;
const ROOM_CONCURRENCY = 8;

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

  const classrooms = Array.isArray(building.classrooms) ? building.classrooms : [];
  const nextBuilding = {
    ...building,
    classrooms: classrooms.map((room) => ({
      ...room,
      availability_times: [],
    })),
  };

  try {
    await runPool(
      nextBuilding.classrooms,
      async (room) => {
        room.availability_times = await fetchRoomAvailability(room.id, date);
      },
      ROOM_CONCURRENCY
    );

    return json(200, nextBuilding);
  } catch (error) {
    return json(502, {
      error: `Failed to fetch availability for ${building.code || building.name || 'building'}`,
      details: error.message,
    });
  }
};
