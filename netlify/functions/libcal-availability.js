const LIBCAL_BASE_URL = 'https://umd.libcal.com';
const LIBCAL_ALLSPACES_URL = `${LIBCAL_BASE_URL}/allspaces`;
const LIBCAL_GRID_URL = `${LIBCAL_BASE_URL}/spaces/availability/grid`;
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_SIZE = 200;

const LOCATION_METADATA = {
  2552: {
    name: 'Theodore R. McKeldin Library',
    code: 'MCKL',
    building_id: 'libcal-mckeldin',
    latitude: 38.9859629,
    longitude: -76.9451156,
  },
  14005: {
    name: 'Art-Sociology Building',
    code: 'ASY',
    building_id: '146',
    latitude: 38.98528145,
    longitude: -76.9478947752967,
  },
  14006: {
    name: 'Clarice Smith Performing Arts Center',
    code: 'PAC',
    building_id: '386',
    latitude: 38.9906807,
    longitude: -76.9504434053224,
  },
  6745: {
    name: 'William E. Kirwan Hall',
    code: 'KIR',
    building_id: 'libcal-kirwan',
    latitude: 38.9886157,
    longitude: -76.9392643,
  },
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

function decodeJsString(raw) {
  try {
    return JSON.parse(`"${String(raw || '').replace(/"/g, '\\"')}"`);
  } catch (_) {
    return String(raw || '');
  }
}

function parseField(block, fieldName, type = 'string') {
  if (type === 'string') {
    const match = block.match(new RegExp(`${fieldName}:\\s*"((?:\\\\.|[^"])*)"`, 'm'));
    return match ? decodeJsString(match[1]) : null;
  }

  if (type === 'number') {
    const match = block.match(new RegExp(`${fieldName}:\\s*(-?\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  }

  if (type === 'boolean') {
    const match = block.match(new RegExp(`${fieldName}:\\s*(true|false)`, 'm'));
    return match ? match[1] === 'true' : null;
  }

  return null;
}

function parseLibCalResources(html) {
  const resources = [];
  const matcher = /resources\.push\(\{([\s\S]*?)\}\);/g;
  let match;

  while ((match = matcher.exec(html))) {
    const block = match[1];
    const lid = parseField(block, 'lid', 'number');
    if (!LOCATION_METADATA[lid]) continue;

    const grouping = parseField(block, 'grouping', 'string') || '';
    if (/equipment/i.test(grouping)) continue;

    const title = parseField(block, 'title', 'string') || '';
    const name = title.replace(/\s*\(Capacity\s+\d+\)\s*$/i, '').trim();
    const capacity =
      parseField(block, 'capacity', 'number') ||
      Number((title.match(/\(Capacity\s+(\d+)\)/i) || [])[1] || 0) ||
      null;

    resources.push({
      id: parseField(block, 'id', 'string'),
      eid: parseField(block, 'eid', 'number'),
      gid: parseField(block, 'gid', 'number'),
      lid,
      title,
      name,
      url: new URL(parseField(block, 'url', 'string') || `/space/${parseField(block, 'eid', 'number')}`, LIBCAL_BASE_URL).toString(),
      grouping,
      gtype: parseField(block, 'gtype', 'number'),
      capacity,
      hasInfo: parseField(block, 'hasInfo', 'boolean'),
    });
  }

  return resources;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchLocationSlots(lid, date) {
  const payload = new URLSearchParams({
    lid: String(lid),
    seat: '0',
    seatId: '0',
    zone: '0',
    start: date,
    end: addDays(date, 1),
    bookings: '[]',
    pageIndex: '0',
    pageSize: String(PAGE_SIZE),
  });

  const response = await fetchWithTimeout(LIBCAL_GRID_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: LIBCAL_ALLSPACES_URL,
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    throw new Error(`LibCal grid returned HTTP ${response.status}`);
  }

  return response.json();
}

function dateTimeToDecimal(dateTimeString) {
  const [, timePart = '00:00:00'] = String(dateTimeString || '').split(' ');
  const [hours, minutes] = timePart.split(':').map(Number);
  return hours + (minutes / 60);
}

function mergeAvailableBlocks(slots) {
  const sorted = slots
    .slice()
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  const merged = [];

  for (const slot of sorted) {
    const startDecimal = dateTimeToDecimal(slot.start);
    const endDecimal = dateTimeToDecimal(slot.end);
    const last = merged[merged.length - 1];

    if (
      last &&
      Math.abs(last.time_end - startDecimal) < 1e-6
    ) {
      last.time_end = endDecimal;
      last.end = slot.end;
      last.slotChecksums.push(slot.checksum);
      last.slots.push({
        start: slot.start,
        end: slot.end,
        checksum: slot.checksum,
      });
      continue;
    }

    merged.push({
      date: String(slot.start).split(' ')[0],
      start: slot.start,
      end: slot.end,
      time_start: startDecimal,
      time_end: endDecimal,
      slotChecksums: [slot.checksum],
      slots: [
        {
          start: slot.start,
          end: slot.end,
          checksum: slot.checksum,
        },
      ],
    });
  }

  return merged;
}

function buildBookedEventsFromAvailableBlocks(availableBlocks) {
  if (!availableBlocks.length) return [];

  const events = [];
  let cursor = availableBlocks[0].time_start;

  for (const block of availableBlocks) {
    if (block.time_start > cursor + 1e-6) {
      events.push({
        date: block.date,
        event_name: 'Reserved',
        time_start: cursor.toFixed(2),
        time_end: block.time_start.toFixed(2),
        status: 1,
        additional_details: 'LibCal unavailable',
      });
    }
    cursor = Math.max(cursor, block.time_end);
  }

  return events;
}

function inferRoomType(resource) {
  const grouping = String(resource.grouping || '').toLowerCase();
  const name = String(resource.name || '').toLowerCase();

  if (grouping.includes('carrel')) return 'Study Carrel';
  if (grouping.includes('podcasting')) return 'Podcasting Lab';
  if (grouping.includes('conversation')) return 'Conversation Room';
  if (grouping.includes('seminar')) return 'Seminar Room';
  if (name.includes('carrel')) return 'Study Carrel';
  return 'Study Room';
}

function buildLibraryBuildings(resources, slotsByLocation) {
  const groupedBuildings = new Map();

  for (const resource of resources) {
    const locationMeta = LOCATION_METADATA[resource.lid];
    const buildingKey = locationMeta.code;
    const locationSlots = slotsByLocation.get(resource.lid) || [];
    const roomSlots = locationSlots.filter(
      (slot) => Number(slot.itemId) === resource.eid && !slot.className
    );
    const availableBlocks = mergeAvailableBlocks(roomSlots);
    const bookedEvents = buildBookedEventsFromAvailableBlocks(availableBlocks);

    const room = {
      id: `libcal-${resource.eid}`,
      name: resource.name,
      type: inferRoomType(resource),
      capacity: resource.capacity,
      floor: null,
      availability_times: bookedEvents,
      source: 'libcal',
      libcal: {
        eid: resource.eid,
        gid: resource.gid,
        lid: resource.lid,
        title: resource.title,
        grouping: resource.grouping,
        booking_url: resource.url,
        available_blocks: availableBlocks,
      },
    };

    if (!groupedBuildings.has(buildingKey)) {
      groupedBuildings.set(buildingKey, {
        name: locationMeta.name,
        code: locationMeta.code,
        building_id: locationMeta.building_id,
        latitude: locationMeta.latitude,
        longitude: locationMeta.longitude,
        classrooms: [],
      });
    }

    groupedBuildings.get(buildingKey).classrooms.push(room);
  }

  return Array.from(groupedBuildings.values());
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

  const { date } = payload || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return badRequest('Expected date in YYYY-MM-DD format');
  }

  try {
    const htmlResponse = await fetchWithTimeout(LIBCAL_ALLSPACES_URL);
    if (!htmlResponse.ok) {
      throw new Error(`LibCal allspaces returned HTTP ${htmlResponse.status}`);
    }

    const html = await htmlResponse.text();
    const resources = parseLibCalResources(html);
    const locationIds = [...new Set(resources.map((resource) => resource.lid))];
    const slotsByLocation = new Map();

    await Promise.all(
      locationIds.map(async (lid) => {
        const result = await fetchLocationSlots(lid, date);
        slotsByLocation.set(lid, Array.isArray(result.slots) ? result.slots : []);
      })
    );

    return json(200, {
      buildings: buildLibraryBuildings(resources, slotsByLocation),
    });
  } catch (error) {
    return json(502, {
      error: 'Failed to fetch library study room availability',
      details: error.message,
    });
  }
};
