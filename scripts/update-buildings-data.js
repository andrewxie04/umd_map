/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.resolve(ROOT, '..', 'UMD_api');

const BUILDINGS_JSON = path.join(API_DIR, 'buildings.json');
const ROOMS_JSON = path.join(API_DIR, 'room_ids.json');
const LABELED_UNMATCHED = path.join(API_DIR, 'labeled_unmatched_classrooms.json');
const UNMATCHED_TO_LABEL = path.join(API_DIR, 'unmatched_classrooms_to_label.json');
const OUTPUT_JSON = path.join(ROOT, 'public', 'buildings_data.json');
const OUTPUT_METADATA_JSON = path.join(ROOT, 'public', 'buildings_metadata.json');

const MAX_WORKERS = Number(process.env.AVAIL_MAX_WORKERS || 25);
const CACHE_HOURS = Number(process.env.AVAIL_CACHE_HOURS || 6);
const FORCE_REFRESH = process.env.AVAIL_FORCE_REFRESH === '1';

const ROOM_LIST_URL = 'https://25live.collegenet.com/25live/data/umd/run/list/listdata.json';
const LOFT_CALENDAR_PAGE_URL = 'https://innovation.umd.edu/loft-calendar';
const ENGINEERING_LABS_URL = 'https://clarknet.eng.umd.edu/computer-labs-all';
const ONE_BUTTON_STUDIOS_URL = 'https://book1button.umd.edu/Web/schedule.php';
const ONE_BUTTON_STUDIOS_INFO_URL = 'https://provost.umd.edu/resources/one-button-studios';
const SUPPLEMENTAL_RANGE_DAYS = 31;
const ROOMS_TO_REMOVE = new Set(['JMZ 1123 (Loss)', 'KEY 0107']);
const BUILDING_QUERY_ID_CANDIDATES = Array.from({ length: 48 }, (_, index) => String(index + 1));
const PER_BUILDING_REQUIRED_CODES = ['AJC', 'ANS', 'ARC', 'ASY', 'BPS', 'EDU', 'SPH', 'TWS', 'TYD', 'VMH'];
const PER_BUILDING_REQUIRED_ROOMS = ['ARC 0204', 'ARC 1127', 'ASY 3219', 'BPS 1238', 'EDU 3315', 'VMH 1203', 'VMH 2211'];
const PER_BUILDING_MIN_ROOM_COUNT = 340;
const DEFAULT_LOFT_CALENDAR_ID =
  'c_85b8aaf1fab1942f8c8c5f5fcbffdfb91d85de1cfef92c8a4918668c403a93b2@group.calendar.google.com';
const DEFAULT_AVW_CALENDARS = [
  {
    roomName: 'AVW 1442',
    roomNumber: '1442',
    pageUrl: 'https://clarknet.eng.umd.edu/computer-labs/avw-1442',
    calendarId: 'c_188bj2ec253hailij4gfm1n6c7i4e@resource.calendar.google.com',
    capacity: 26,
    accessNote: 'ECE/ISR/ENTS faculty, staff, and students',
  },
  {
    roomName: 'AVW 1454',
    roomNumber: '1454',
    pageUrl: 'https://clarknet.eng.umd.edu/computer-labs/avw-1454',
    calendarId: 'c_1884g7v449bvijc9l4sha6ft552rk@resource.calendar.google.com',
    capacity: 12,
    accessNote: 'ECE/ISR/ENTS faculty, staff, and students unless reserved',
  },
  {
    roomName: 'AVW 2446',
    roomNumber: '2446',
    pageUrl: 'https://clarknet.eng.umd.edu/computer-labs/avw-2446',
    calendarId: 'umd.edu_fufjfgvi0e0a199rqe9tvp9fuo@group.calendar.google.com',
    capacity: 25,
    accessNote: 'ECE/ISR/ENTS faculty, staff, and students unless reserved',
  },
];
const DEFAULT_ENGINEERING_LABS = [
  {
    id: 'supp-egr-0310',
    name: 'EGR 0310',
    room_number: '0310',
    building_code: 'EGR',
    type: 'Computer Lab',
    capacity: 12,
    has_computers: true,
    access_note: 'Faculty, staff, and students',
    details_note: '24/7 except holidays',
    source_url: 'https://clarknet.eng.umd.edu/computer-labs/egr-0310',
    source_label: 'Official Lab Page',
    supplemental: {
      mode: 'hours',
      hours: { type: 'always', holidayClosed: true },
    },
  },
  {
    id: 'supp-egr-0312',
    name: 'EGR 0312',
    room_number: '0312',
    building_code: 'EGR',
    type: 'Computer Lab',
    capacity: 29,
    has_computers: true,
    access_note: 'Faculty, staff, and students',
    details_note: '24/7 except holidays; reservations shown on the official lab page',
    source_url: 'https://clarknet.eng.umd.edu/computer-labs/egr-0312',
    source_label: 'Official Lab Page',
    supplemental: {
      mode: 'calendar',
      calendar_id: 'c_18839oa5og6noh83krtidm3lkgngg@resource.calendar.google.com',
      hours: { type: 'always', holidayClosed: true },
    },
  },
  {
    id: 'supp-egr-1156',
    name: 'EGR 1156',
    room_number: '1156',
    building_code: 'EGR',
    type: 'Computer Lab',
    capacity: 40,
    has_computers: true,
    access_note: 'Civil classes only',
    details_note: '24/7; reservations shown on the official lab page',
    source_url: 'https://clarknet.eng.umd.edu/computer-labs/egr-1156',
    source_label: 'Official Lab Page',
    supplemental: {
      mode: 'calendar',
      calendar_id: 'umd.edu_6433@resource.calendar.google.com',
      hours: { type: 'always', holidayClosed: false },
    },
  },
  {
    id: 'supp-jmp-3106a',
    name: 'JMP 3106a',
    room_number: '3106a',
    building_code: 'JMP',
    type: 'Computer Lab',
    capacity: 10,
    has_computers: true,
    access_note: 'FPE students only',
    details_note: 'Open 7 AM-6 PM Monday-Friday',
    source_url: 'https://clarknet.eng.umd.edu/computer-labs/jmp-3106a',
    source_label: 'Official Lab Page',
    supplemental: {
      mode: 'hours',
      hours: { type: 'weekday-window', start: 7, end: 18 },
    },
  },
  {
    id: 'supp-keb-2107',
    name: 'KEB 2107',
    room_number: '2107',
    building_code: 'KEB',
    type: 'Computer Lab',
    capacity: 30,
    has_computers: true,
    access_note: 'Faculty, staff, and students unless reserved for class',
    details_note: 'Open 7 AM-6 PM Monday-Friday; reservations shown on the official lab page',
    source_url: 'https://clarknet.eng.umd.edu/computer-labs/keb-2107',
    source_label: 'Official Lab Page',
    supplemental: {
      mode: 'calendar',
      calendar_id: 'c_188cjnfq048tehehnq1khb63vhbiu@resource.calendar.google.com',
      hours: { type: 'weekday-window', start: 7, end: 18 },
    },
  },
  {
    id: 'supp-keb-2111',
    name: 'KEB 2111',
    room_number: '2111',
    building_code: 'KEB',
    type: 'Computer Lab',
    capacity: 42,
    has_computers: true,
    access_note: 'Faculty, staff, and students unless reserved for class',
    details_note: 'Open 7 AM-6 PM Monday-Friday; reservations shown on the official lab page',
    source_url: 'https://clarknet.eng.umd.edu/computer-labs/keb-2111',
    source_label: 'Official Lab Page',
    supplemental: {
      mode: 'calendar',
      calendar_id: 'c_1885jurti9ukgh03ldb67icdt2boe@resource.calendar.google.com',
      hours: { type: 'weekday-window', start: 7, end: 18 },
    },
  },
];
const DEFAULT_ONE_BUTTON_STUDIOS = [
  {
    id: 'supp-obs-atl-1400a',
    name: 'ATL 1400A',
    room_number: '1400A',
    building_code: 'ATL',
  },
  {
    id: 'supp-obs-edu-0227a',
    name: 'EDU 0227A',
    room_number: '0227A',
    building_code: 'EDU',
  },
  {
    id: 'supp-obs-csi-1113',
    name: 'CSI 1113',
    room_number: '1113',
    building_code: 'CSI',
  },
  {
    id: 'supp-obs-esj-0105a',
    name: 'ESJ 0105A',
    room_number: '0105A',
    building_code: 'ESJ',
  },
  {
    id: 'supp-obs-mck-1100a',
    name: 'MCK 1100A',
    room_number: '1100A',
    building_code: 'MCK',
  },
  {
    id: 'supp-obs-pls-1132',
    name: 'PLS 1132',
    room_number: '1132',
    building_code: 'PLS',
  },
  {
    id: 'supp-obs-tyd-0103',
    name: 'TYD 0103',
    room_number: '0103',
    building_code: 'TYD',
  },
].map((studio) => ({
  ...studio,
  type: 'One Button Studio',
  access_note: 'Posted studio hours only — check the official scheduler for live reservations.',
  details_note:
    'UMD login required to book. Most studios are open Monday–Thursday 9 AM–9 PM and Friday 9 AM–4 PM.',
  source_url: ONE_BUTTON_STUDIOS_URL,
  source_label: 'Official Studio Scheduler',
  source_secondary_url: ONE_BUTTON_STUDIOS_INFO_URL,
  source_secondary_label: 'Studio Info',
  supplemental: {
    mode: 'hours',
    hours: {
      type: 'weekly-windows',
      windows: {
        1: [{ start: 9, end: 21 }],
        2: [{ start: 9, end: 21 }],
        3: [{ start: 9, end: 21 }],
        4: [{ start: 9, end: 21 }],
        5: [{ start: 9, end: 16 }],
      },
    },
  },
}));
function parseCapacity(rawCapacity) {
  const capacity = Number(rawCapacity);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : null;
}

function isComputerClassroom(row) {
  const combined = [row?.detail, row?.rawType, row?.features]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return combined.includes('computer classroom') || combined.includes('computer classrm');
}

function classifyRoomType(room) {
  if (room?.type && room.type !== 'Classroom') {
    return room.type;
  }

  if (room?.has_computers) {
    return 'Computer Classroom';
  }

  const capacity = parseCapacity(room?.capacity);
  if (capacity == null) return 'Classroom';
  if (capacity <= 20) return 'Seminar Room';
  if (capacity <= 35) return 'Classroom';
  if (capacity <= 79) return 'Large Classroom';
  if (capacity <= 150) return 'Small Lecture Hall';
  return 'Large Lecture Hall';
}

function parseBuildingCodeFromLabel(label) {
  const match = String(label || '').match(/\(([A-Z0-9 ]+)\)\s*$/);
  return match ? match[1].trim() : '';
}

function parseBuildingCodeFromRoomName(name) {
  const match = String(name || '').match(/^([A-Z0-9]{2,6})\s+/);
  return match ? match[1].trim() : '';
}

function parseRoomRow(rowEntry, seenIds, buildingIdSet) {
  const row = Array.isArray(rowEntry?.row) ? rowEntry.row : [];
  const room = row[0];
  if (!room || typeof room !== 'object') return null;

  const id = room.itemId;
  const name = room.itemName;
  if (!id || !name || seenIds.has(String(id)) || buildingIdSet.has(String(id))) return null;

  const detail = typeof row[1] === 'string' ? row[1] : '';
  const rawType = typeof row[2] === 'string' ? row[2] : '';
  const features = typeof row[3] === 'string' ? row[3] : '';
  const capacity = parseCapacity(row[5]);
  const hasComputers = isComputerClassroom({ detail, rawType, features });
  const buildingMeta = row[6] && typeof row[6] === 'object' ? row[6] : null;
  const buildingCode =
    parseBuildingCodeFromLabel(buildingMeta?.itemName) || parseBuildingCodeFromRoomName(name);

  return {
    room: {
      id,
      name,
      detail,
      rawType,
      features,
      capacity,
      has_computers: hasComputers,
      type: classifyRoomType({ capacity, has_computers: hasComputers }),
    },
    buildingCode,
  };
}

async function fetchRoomIdsFromCombinedQuery(buildingsData) {
  const rooms = [];
  const seen = new Set();
  const pageSize = 1000;
  const buildingIds = Array.from(
    new Set(
      (Array.isArray(buildingsData) ? buildingsData : [])
        .map((building) => String(building.building_id || '').trim())
        .filter(Boolean)
    )
  );
  const buildingIdSet = new Set(buildingIds);

  for (let page = 1; page <= 10; page += 1) {
    const params = new URLSearchParams({
      compsubject: 'location',
      sort: 'name',
      order: 'asc',
      page: String(page),
      page_size: String(pageSize),
      obj_cache_accl: '0',
      caller: 'pro-ListService.getData',
      spaces_building_id: buildingIds.join(' '),
    });

    const res = await fetchWithTimeout(`${ROOM_LIST_URL}?${params.toString()}`, 15000);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    let addedThisPage = 0;
    for (const rowEntry of data.rows || []) {
      const parsed = parseRoomRow(rowEntry, seen, buildingIdSet);
      if (!parsed) continue;

      seen.add(String(parsed.room.id));
      rooms.push(parsed.room);
      addedThisPage += 1;
    }

    if (addedThisPage < pageSize) {
      break;
    }
  }

  return rooms.filter((room) => !ROOMS_TO_REMOVE.has(String(room.name || '').trim()));
}

async function fetchRoomsForBuildingQueryId(queryId, seenIds, buildingIdSet) {
  const params = new URLSearchParams({
    compsubject: 'location',
    sort: 'name',
    order: 'asc',
    page: '1',
    page_size: '1000',
    obj_cache_accl: '0',
    caller: 'pro-ListService.getData',
    building_id: String(queryId),
  });

  const res = await fetchWithTimeout(`${ROOM_LIST_URL}?${params.toString()}`, 15000);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const parsedRows = [];
  for (const rowEntry of data.rows || []) {
    const parsed = parseRoomRow(rowEntry, seenIds, buildingIdSet);
    if (parsed) {
      parsedRows.push(parsed);
    }
  }

  return parsedRows;
}

async function fetchRoomIdsPerBuilding(buildingsData) {
  const targetCodes = new Set(
    (Array.isArray(buildingsData) ? buildingsData : [])
      .map((building) => String(building.code || '').trim())
      .filter(Boolean)
  );
  const buildingIdSet = new Set(
    (Array.isArray(buildingsData) ? buildingsData : [])
      .map((building) => String(building.building_id || '').trim())
      .filter(Boolean)
  );
  const seenIds = new Set();
  const roomsByCode = new Map();

  await runPool(
    BUILDING_QUERY_ID_CANDIDATES,
    async (queryId) => {
      const rows = await fetchRoomsForBuildingQueryId(queryId, seenIds, buildingIdSet);
      if (!rows.length) return;

      const codes = Array.from(new Set(rows.map((entry) => entry.buildingCode).filter(Boolean)));
      if (codes.length !== 1) {
        return;
      }

      const code = codes[0];
      if (!targetCodes.has(code)) {
        return;
      }

      const bucket = roomsByCode.get(code) || [];
      for (const entry of rows) {
        if (seenIds.has(String(entry.room.id))) continue;
        seenIds.add(String(entry.room.id));
        bucket.push(entry.room);
      }
      roomsByCode.set(code, bucket);
    },
    Math.min(MAX_WORKERS, 8)
  );

  const rooms = Array.from(roomsByCode.values()).flat();
  const missingRequiredCodes = PER_BUILDING_REQUIRED_CODES.filter((code) => !roomsByCode.has(code));
  const roomNames = new Set(rooms.map((room) => String(room.name || '').trim()));
  const missingRequiredRooms = PER_BUILDING_REQUIRED_ROOMS.filter((name) => !roomNames.has(name));
  if (rooms.length < PER_BUILDING_MIN_ROOM_COUNT || missingRequiredCodes.length || missingRequiredRooms.length) {
    throw new Error(
      `Per-building room import looked incomplete ` +
        `(rooms=${rooms.length}, missing codes=${missingRequiredCodes.join(', ') || 'none'}, ` +
        `missing rooms=${missingRequiredRooms.join(', ') || 'none'})`
    );
  }

  return rooms.filter((room) => !ROOMS_TO_REMOVE.has(String(room.name || '').trim()));
}

async function fetchRoomIdsFrom25Live(buildingsData) {
  try {
    return await fetchRoomIdsPerBuilding(buildingsData);
  } catch (error) {
    console.warn(`Per-building room import failed validation; falling back to combined query: ${error.message}`);
    return fetchRoomIdsFromCombinedQuery(buildingsData);
  }
}

function parseDateKey(dateString) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function formatDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftDateKey(dateKey, deltaDays) {
  const base = parseDateKey(dateKey);
  base.setDate(base.getDate() + deltaDays);
  return formatDateKey(base);
}

function getDateRange(dateKey, days = SUPPLEMENTAL_RANGE_DAYS) {
  const range = [];
  for (let i = 0; i < days; i += 1) {
    range.push(shiftDateKey(dateKey, i));
  }
  return range;
}

function getEasternParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function decimalHour(hour, minute = 0) {
  return hour + minute / 60;
}

function formatDecimal(decimal) {
  return Number(decimal).toFixed(6);
}

function getSupplementalHoursWindowsForDay(hours, dayOfWeek) {
  if (!hours) return [];
  if (hours.type === 'always') {
    return [{ start: 0, end: 24 }];
  }
  if (hours.type === 'weekday-window') {
    if (dayOfWeek === 0 || dayOfWeek === 6) return [];
    return [{ start: hours.start ?? 7, end: hours.end ?? 22 }];
  }
  if (hours.type === 'weekly-windows') {
    return Array.isArray(hours.windows?.[dayOfWeek]) ? hours.windows[dayOfWeek] : [];
  }
  return [{ start: 7, end: 22 }];
}

function unfoldIcsLines(icsText) {
  return String(icsText || '')
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/);
}

function parseIcsProperty(rawKey) {
  const [name, ...paramParts] = String(rawKey || '').split(';');
  const params = {};

  for (const part of paramParts) {
    const [paramName, rawValue] = part.split('=');
    if (!paramName || rawValue == null) continue;
    params[paramName.toUpperCase()] = rawValue;
  }

  return {
    name: String(name || '').toUpperCase(),
    params,
  };
}

function parseIcsDateValue(rawKey, rawValue) {
  if (!rawValue) return null;
  const { params } = parseIcsProperty(rawKey);
  const value = String(rawValue).trim();

  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return { kind: 'date', dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
  }

  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return {
      kind: 'datetime-utc',
      date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
    };
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return {
      kind: 'datetime-local',
      tzid: params.TZID || 'America/New_York',
      dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      hour,
      minute,
      second,
    };
  }
  return null;
}

function getEasternDateTimeParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function normalizeParsedDateTime(parsed) {
  if (!parsed) return null;
  if (parsed.dateKey && Number.isFinite(parsed.hour) && Number.isFinite(parsed.minute)) {
    return {
      dateKey: parsed.dateKey,
      hour: parsed.hour,
      minute: parsed.minute,
      second: parsed.second || 0,
    };
  }
  if (parsed.kind === 'date') {
    return { dateKey: parsed.dateKey, hour: 0, minute: 0, second: 0 };
  }
  if (parsed.kind === 'datetime-local') {
    return {
      dateKey: parsed.dateKey,
      hour: parsed.hour,
      minute: parsed.minute,
      second: parsed.second || 0,
    };
  }
  if (parsed.kind === 'datetime-utc') {
    return getEasternDateTimeParts(parsed.date);
  }
  return null;
}

function localDateTimeKey(parsed) {
  const normalized = normalizeParsedDateTime(parsed);
  if (!normalized) return null;
  return [
    normalized.dateKey,
    String(normalized.hour).padStart(2, '0'),
    String(normalized.minute).padStart(2, '0'),
    String(normalized.second || 0).padStart(2, '0'),
  ].join('T');
}

function compareLocalDateTimes(left, right) {
  return localDateTimeKey(left).localeCompare(localDateTimeKey(right));
}

function diffDateKeys(leftDateKey, rightDateKey) {
  const left = parseDateKey(leftDateKey);
  const right = parseDateKey(rightDateKey);
  return Math.round((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

function localMinutes(parts) {
  return (parts.hour || 0) * 60 + (parts.minute || 0) + (parts.second || 0) / 60;
}

function minutesBetweenLocalDateTimes(startParts, endParts) {
  return diffDateKeys(startParts.dateKey, endParts.dateKey) * 24 * 60 + (localMinutes(endParts) - localMinutes(startParts));
}

function addMinutesToLocalDateTime(startParts, minutesToAdd) {
  let totalMinutes = Math.round(localMinutes(startParts) + minutesToAdd);
  let dateKey = startParts.dateKey;

  while (totalMinutes < 0) {
    totalMinutes += 24 * 60;
    dateKey = shiftDateKey(dateKey, -1);
  }

  while (totalMinutes >= 24 * 60) {
    totalMinutes -= 24 * 60;
    dateKey = shiftDateKey(dateKey, 1);
  }

  return {
    dateKey,
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
    second: 0,
  };
}

const ICS_DAY_TO_NUMERIC_DAY = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const NUMERIC_DAY_TO_ICS_DAY = Object.fromEntries(
  Object.entries(ICS_DAY_TO_NUMERIC_DAY).map(([key, value]) => [value, key])
);

function getDateKeyWeekday(dateKey) {
  return parseDateKey(dateKey).getDay();
}

function getWeekStartDateKey(dateKey, weekStartDay) {
  const weekday = getDateKeyWeekday(dateKey);
  const delta = (weekday - weekStartDay + 7) % 7;
  return shiftDateKey(dateKey, -delta);
}

function parseRRule(rawValue) {
  if (!rawValue) return null;
  const values = {};
  for (const segment of String(rawValue).split(';')) {
    const [name, value] = segment.split('=');
    if (!name || value == null) continue;
    values[name.toUpperCase()] = value;
  }

  return {
    freq: values.FREQ || null,
    interval: Number(values.INTERVAL || 1),
    byday: values.BYDAY ? values.BYDAY.split(',').map((value) => value.trim()).filter(Boolean) : [],
    wkst: values.WKST || 'SU',
    until: values.UNTIL ? parseIcsDateValue('UNTIL', values.UNTIL) : null,
    count: values.COUNT ? Number(values.COUNT) : null,
  };
}

function eventShouldBlock(current) {
  return current?.status !== 'CANCELLED' && current?.transparency !== 'TRANSPARENT';
}

function buildOccurrenceKey(uid, parsedDateTime) {
  const normalized = normalizeParsedDateTime(parsedDateTime);
  if (!uid || !normalized) return null;
  return `${uid}|${localDateTimeKey(normalized)}`;
}

function expandRecurringEventDates(event, startDateKey, days) {
  const rule = event.rrule;
  const startLocal = normalizeParsedDateTime(event.dtStart);
  if (!rule?.freq || !startLocal) return [];

  const rangeDates = getDateRange(startDateKey, days);
  const interval = Number.isFinite(rule.interval) && rule.interval > 0 ? rule.interval : 1;
  const untilLocal = normalizeParsedDateTime(rule.until);
  const countLimit = Number.isFinite(rule.count) && rule.count > 0 ? rule.count : null;
  const weekStartDay = ICS_DAY_TO_NUMERIC_DAY[rule.wkst] ?? 0;
  const startWeekKey = getWeekStartDateKey(startLocal.dateKey, weekStartDay);
  const byDaySet = new Set(
    (rule.byday.length ? rule.byday : [NUMERIC_DAY_TO_ICS_DAY[getDateKeyWeekday(startLocal.dateKey)]])
      .map((value) => value.toUpperCase())
      .filter((value) => value in ICS_DAY_TO_NUMERIC_DAY)
  );

  const matchesDate = (dateKey) => {
    if (dateKey < startLocal.dateKey) return false;

    if (rule.freq === 'DAILY') {
      return diffDateKeys(startLocal.dateKey, dateKey) % interval === 0;
    }

    if (rule.freq === 'WEEKLY') {
      const dayCode = NUMERIC_DAY_TO_ICS_DAY[getDateKeyWeekday(dateKey)];
      if (!byDaySet.has(dayCode)) return false;
      const candidateWeekKey = getWeekStartDateKey(dateKey, weekStartDay);
      const weekDiff = diffDateKeys(startWeekKey, candidateWeekKey) / 7;
      return Number.isInteger(weekDiff) && weekDiff >= 0 && weekDiff % interval === 0;
    }

    return false;
  };

  const occurrences = [];
  for (const dateKey of rangeDates) {
    if (!matchesDate(dateKey)) continue;

    const occurrenceStart = {
      dateKey,
      hour: startLocal.hour,
      minute: startLocal.minute,
      second: startLocal.second || 0,
    };

    if (compareLocalDateTimes(occurrenceStart, startLocal) < 0) continue;
    if (untilLocal && compareLocalDateTimes(occurrenceStart, untilLocal) > 0) continue;

    occurrences.push(occurrenceStart);
  }

  if (!countLimit) {
    return occurrences;
  }

  // COUNT limits total occurrences from the event's DTSTART, not just within our window.
  // Count how many occurrences happened before the range window.
  const daysBeforeRange = diffDateKeys(startLocal.dateKey, startDateKey);
  let priorCount = 0;
  if (daysBeforeRange > 0) {
    const preWindowDates = getDateRange(startLocal.dateKey, daysBeforeRange);
    for (const dateKey of preWindowDates) {
      if (matchesDate(dateKey)) priorCount++;
    }
  }
  const remaining = countLimit - priorCount;
  return remaining > 0 ? occurrences.slice(0, remaining) : [];
}

function pushBusySegments(availability, eventName, startParts, endParts, details = 'calendar') {
  let segmentStart = normalizeParsedDateTime(startParts);
  const normalizedEnd = normalizeParsedDateTime(endParts);
  if (!segmentStart || !normalizedEnd || compareLocalDateTimes(segmentStart, normalizedEnd) >= 0) {
    return;
  }

  while (compareLocalDateTimes(segmentStart, normalizedEnd) < 0) {
    const dayBoundary = { dateKey: segmentStart.dateKey, hour: 24, minute: 0, second: 0 };
    const segmentEnd =
      compareLocalDateTimes(normalizedEnd, dayBoundary) < 0 ? normalizedEnd : dayBoundary;

    availability.push({
      date: `${segmentStart.dateKey}T00:00:00`,
      event_name: eventName || 'Busy',
      time_start: formatDecimal(decimalHour(segmentStart.hour, segmentStart.minute)),
      time_end: formatDecimal(
        segmentEnd.hour >= 24 ? 24 : decimalHour(segmentEnd.hour, segmentEnd.minute)
      ),
      status: 1,
      additional_details: details,
    });

    segmentStart = {
      dateKey: shiftDateKey(segmentStart.dateKey, 1),
      hour: 0,
      minute: 0,
      second: 0,
    };
  }
}

function parseGoogleCalendarBusyEvents(icsText, startDateKey, days = SUPPLEMENTAL_RANGE_DAYS) {
  const startDate = parseDateKey(startDateKey);
  const rangeEnd = new Date(startDate);
  rangeEnd.setDate(rangeEnd.getDate() + days);
  const rangeEndKey = formatDateKey(rangeEnd);
  const lines = unfoldIcsLines(icsText);
  const events = [];
  const overrides = new Map();
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { exDates: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.dtStart && current?.dtEnd) {
        if (current.recurrenceId) {
          const overrideKey = buildOccurrenceKey(current.uid, current.recurrenceId);
          if (overrideKey) {
            overrides.set(overrideKey, eventShouldBlock(current) ? current : null);
          }
        } else if (eventShouldBlock(current)) {
          events.push(current);
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const rawKey = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    const property = parseIcsProperty(rawKey);
    if (property.name === 'DTSTART') {
      current.dtStart = parseIcsDateValue(rawKey, value);
    } else if (property.name === 'DTEND') {
      current.dtEnd = parseIcsDateValue(rawKey, value);
    } else if (property.name === 'SUMMARY') {
      current.summary = value || 'Busy';
    } else if (property.name === 'RRULE') {
      current.rrule = parseRRule(value);
    } else if (property.name === 'EXDATE') {
      current.exDates.push(
        ...String(value)
          .split(',')
          .map((entry) => parseIcsDateValue(rawKey, entry))
          .filter(Boolean)
      );
    } else if (property.name === 'RECURRENCE-ID') {
      current.recurrenceId = parseIcsDateValue(rawKey, value);
    } else if (property.name === 'UID') {
      current.uid = value || null;
    } else if (property.name === 'STATUS') {
      current.status = value || null;
    } else if (property.name === 'TRANSP') {
      current.transparency = value || null;
    }
  }

  const availability = [];
  for (const event of events) {
    const startLocal = normalizeParsedDateTime(event.dtStart);
    const endLocal = normalizeParsedDateTime(event.dtEnd);
    if (!startLocal || !endLocal) continue;

    if (event.dtStart.kind === 'date' && event.dtEnd.kind === 'date') {
      let cursor = startLocal.dateKey;
      while (cursor < endLocal.dateKey) {
        if (cursor >= startDateKey && cursor < rangeEndKey) {
          pushBusySegments(
            availability,
            event.summary || 'Busy',
            { dateKey: cursor, hour: 0, minute: 0, second: 0 },
            { dateKey: shiftDateKey(cursor, 1), hour: 0, minute: 0, second: 0 }
          );
        }
        cursor = shiftDateKey(cursor, 1);
      }
      continue;
    }

    if (event.rrule?.freq) {
      const occurrenceStarts = expandRecurringEventDates(event, startDateKey, days);
      const eventDurationMinutes = minutesBetweenLocalDateTimes(startLocal, endLocal);
      if (eventDurationMinutes <= 0) continue;
      const exDateKeys = new Set((event.exDates || []).map((entry) => buildOccurrenceKey(event.uid, entry)).filter(Boolean));

      for (const occurrenceStart of occurrenceStarts) {
        const occurrenceKey = buildOccurrenceKey(event.uid, occurrenceStart);
        if (occurrenceKey && exDateKeys.has(occurrenceKey)) continue;

        const override = occurrenceKey ? overrides.get(occurrenceKey) : undefined;
        if (override === null) continue;
        if (override) continue;

        const occurrenceEnd = addMinutesToLocalDateTime(occurrenceStart, eventDurationMinutes);
        if (occurrenceStart.dateKey >= rangeEndKey || occurrenceEnd.dateKey < startDateKey) continue;
        pushBusySegments(availability, event.summary || 'Busy', occurrenceStart, occurrenceEnd);
      }
      continue;
    }

    if (startLocal.dateKey >= rangeEndKey || endLocal.dateKey < startDateKey) continue;
    pushBusySegments(availability, event.summary || 'Busy', startLocal, endLocal);
  }

  for (const overrideEvent of overrides.values()) {
    if (!overrideEvent) continue;
    const startLocal = normalizeParsedDateTime(overrideEvent.dtStart);
    const endLocal = normalizeParsedDateTime(overrideEvent.dtEnd);
    if (!startLocal || !endLocal) continue;
    if (startLocal.dateKey >= rangeEndKey || endLocal.dateKey < startDateKey) continue;
    pushBusySegments(availability, overrideEvent.summary || 'Busy', startLocal, endLocal);
  }

  return availability
    .filter((slot) => Number(slot.time_end) > Number(slot.time_start))
    .sort((a, b) =>
      `${a.date}|${a.time_start}|${a.time_end}|${a.event_name}`.localeCompare(
        `${b.date}|${b.time_start}|${b.time_end}|${b.event_name}`
      )
    )
    .filter((slot, index, slots) => {
      if (index === 0) return true;
      const currentKey = `${slot.date}|${slot.time_start}|${slot.time_end}|${slot.event_name}|${slot.additional_details}`;
      const previous = slots[index - 1];
      const previousKey = `${previous.date}|${previous.time_start}|${previous.time_end}|${previous.event_name}|${previous.additional_details}`;
      return currentKey !== previousKey;
    });
}

function createSupplementalBusyEvents(startDateKey, supplementalConfig) {
  const dateKeys = getDateRange(startDateKey);
  const availability = [];
  const hours = supplementalConfig?.hours || {};

  if (hours.type === 'always') {
    return availability;
  }

  for (const dateKey of dateKeys) {
    const date = parseDateKey(dateKey);
    const day = date.getDay();
    const windows = getSupplementalHoursWindowsForDay(hours, day)
      .map((window) => ({
        start: Number(window.start),
        end: Number(window.end),
      }))
      .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
      .sort((a, b) => a.start - b.start);

    if (!windows.length) {
      availability.push({
        date: `${dateKey}T00:00:00`,
        event_name: 'Closed',
        time_start: formatDecimal(7),
        time_end: formatDecimal(22),
        status: 1,
        additional_details: 'supplemental-hours',
      });
      continue;
    }

    let cursor = 7;
    for (const window of windows) {
      if (window.start > cursor) {
        availability.push({
          date: `${dateKey}T00:00:00`,
          event_name: 'Closed',
          time_start: formatDecimal(cursor),
          time_end: formatDecimal(window.start),
          status: 1,
          additional_details: 'supplemental-hours',
        });
      }
      cursor = Math.max(cursor, window.end);
    }
    if (cursor < 22) {
      availability.push({
        date: `${dateKey}T00:00:00`,
        event_name: 'Closed',
        time_start: formatDecimal(cursor),
        time_end: formatDecimal(22),
        status: 1,
        additional_details: 'supplemental-hours',
      });
    }
  }

  return availability;
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

async function fetchCalendarAvailability(calendarId, startDateKey) {
  const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/full.ics`;
  const text = await fetchTextWithTimeout(url, 15000);
  return parseGoogleCalendarBusyEvents(text, startDateKey);
}

function buildSupplementalRoom(base, building, availabilityTimes) {
  return {
    id: base.id,
    name: base.name,
    room_number: base.room_number,
    capacity: base.capacity ?? null,
    has_whiteboard: base.has_whiteboard ?? false,
    has_projector: base.has_projector ?? false,
    has_computers: base.has_computers ?? false,
    type: base.type || 'Classroom',
    access_note: base.access_note || null,
    details_note: base.details_note || null,
    source_url: base.source_url || null,
    source_label: base.source_label || null,
    source_secondary_url: base.source_secondary_url || null,
    source_secondary_label: base.source_secondary_label || null,
    building_name: building.name,
    building_code: building.code,
    building_latitude: building.latitude,
    building_longitude: building.longitude,
    availability_times: Array.isArray(availabilityTimes) ? availabilityTimes : [],
    source: 'supplemental',
    supplemental: base.supplemental || null,
  };
}

async function appendSupplementalSpaces(buildings, startDateKey) {
  const byCode = new Map(buildings.filter((building) => building.code).map((building) => [building.code, building]));
  const calendarRooms = [];

  for (const spec of DEFAULT_AVW_CALENDARS) {
    const building = byCode.get('AVW');
    if (!building) continue;
    calendarRooms.push(
      buildSupplementalRoom(
        {
          id: `supp-avw-${spec.roomNumber.toLowerCase()}`,
          name: spec.roomName,
          room_number: spec.roomNumber,
          capacity: spec.capacity,
          has_computers: true,
          type: 'Computer Lab',
          access_note: spec.accessNote,
          details_note: 'Check the official ECE lab calendar for reservations',
          source_url: spec.pageUrl || 'https://ask.eng.umd.edu/96324',
          source_label: 'Official Lab Page',
          supplemental: {
            mode: 'calendar',
            hours: { type: 'weekday-window', start: 7, end: 22 },
          },
        },
        building,
        []
      )
    );
  }

  const loftBuilding = byCode.get('ESJ');
  if (loftBuilding) {
    calendarRooms.push(
      buildSupplementalRoom(
        {
          id: 'supp-esj-2101-loft',
          name: 'ESJ 2101 (The Loft)',
          room_number: '2101',
          capacity: null,
          has_computers: false,
          type: 'Innovation Space',
          access_note: 'See the official Loft calendar for reservations',
          details_note: 'The Loft is located in room 2101 of ESJ',
          source_url: LOFT_CALENDAR_PAGE_URL,
          source_label: 'Official Loft Calendar',
          supplemental: {
            mode: 'calendar',
            hours: { type: 'weekday-window', start: 7, end: 22 },
          },
        },
        loftBuilding,
        []
      )
    );
  }

  for (const room of calendarRooms) {
    try {
      const calendarId =
        room.name === 'ESJ 2101 (The Loft)'
          ? DEFAULT_LOFT_CALENDAR_ID
          : DEFAULT_AVW_CALENDARS.find((spec) => spec.roomName === room.name)?.calendarId;
      room.availability_times = calendarId
        ? [
            ...createSupplementalBusyEvents(startDateKey, room.supplemental),
            ...(await fetchCalendarAvailability(calendarId, startDateKey)),
          ].sort((a, b) => `${a.date}|${a.time_start}`.localeCompare(`${b.date}|${b.time_start}`))
        : createSupplementalBusyEvents(startDateKey, room.supplemental);
    } catch (error) {
      console.warn(`Supplemental calendar fetch failed for ${room.name}: ${error.message}`);
      room.availability_times = createSupplementalBusyEvents(startDateKey, room.supplemental);
    }
  }

  for (const room of calendarRooms) {
    const building = byCode.get(room.building_code);
    if (building && !building.classrooms.some((existing) => String(existing.id) === String(room.id))) {
      building.classrooms.push(room);
    }
  }

  for (const base of DEFAULT_ENGINEERING_LABS) {
    const building = byCode.get(base.building_code);
    if (!building) continue;
    let availabilityTimes = createSupplementalBusyEvents(startDateKey, base.supplemental);
    if (base.supplemental?.mode === 'calendar' && base.supplemental?.calendar_id) {
      try {
        const calendarAvailability = await fetchCalendarAvailability(
          base.supplemental.calendar_id,
          startDateKey
        );
        availabilityTimes = [...availabilityTimes, ...calendarAvailability].sort((a, b) =>
          `${a.date}|${a.time_start}`.localeCompare(`${b.date}|${b.time_start}`)
        );
      } catch (error) {
        console.warn(`Supplemental calendar fetch failed for ${base.name}: ${error.message}`);
      }
    }
    const room = buildSupplementalRoom(base, building, availabilityTimes);
    if (!building.classrooms.some((existing) => String(existing.id) === String(room.id))) {
      building.classrooms.push(room);
    }
  }

  for (const base of DEFAULT_ONE_BUTTON_STUDIOS) {
    const building = byCode.get(base.building_code);
    if (!building) continue;
    const room = buildSupplementalRoom(
      base,
      building,
      createSupplementalBusyEvents(startDateKey, base.supplemental)
    );
    if (!building.classrooms.some((existing) => String(existing.id) === String(room.id))) {
      building.classrooms.push(room);
    }
  }
}

function loadRoomsData() {
  if (!fs.existsSync(ROOMS_JSON)) {
    throw new Error('Missing room_ids.json fallback file.');
  }

  return readJson(ROOMS_JSON);
}

function fileFreshEnough(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < CACHE_HOURS * 60 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

function cachedFileCoversStartDate(filePath, startDate) {
  try {
    const data = readJson(filePath);
    if (!Array.isArray(data) || data.length === 0) return false;

    let minDate = null;
    let maxDate = null;

    for (const building of data) {
      for (const room of building.classrooms || []) {
        for (const slot of room.availability_times || []) {
          const date = String(slot.date || '').split('T')[0];
          if (!date) continue;
          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;
        }
      }
    }

    if (!minDate || !maxDate) return false;
    return startDate >= minDate && startDate <= maxDate;
  } catch (_) {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildMetadata(buildings) {
  return buildings.map((building) => ({
    name: building.name || '',
    code: building.code || null,
    building_id: building.building_id || '',
    latitude: Number(building.latitude || 0),
    longitude: Number(building.longitude || 0),
    classrooms: [],
  }));
}

function writeMetadataFile(buildings) {
  fs.writeFileSync(OUTPUT_METADATA_JSON, JSON.stringify(buildMetadata(buildings), null, 2));
}

function getTodayInEastern() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function buildBuildings(buildingsData, roomsData, labeledUnmatched) {
  const buildings = buildingsData.map((b) => ({
    name: b.name || '',
    code: b.code || null,
    building_id: b.building_id || '',
    latitude: Number(b.latitude || 0),
    longitude: Number(b.longitude || 0),
    classrooms: [],
  }));

  const byCode = new Map(buildings.filter((b) => b.code).map((b) => [b.code, b]));
  const byName = new Map(buildings.map((b) => [b.name, b]));

  const unmatched = [];

  for (const room of roomsData) {
    const parts = String(room.name || '').split(' ');
    if (parts.length >= 2) {
      const buildingCode = parts[0];
      const roomNumber = parts.slice(1).join(' ');
      const building = byCode.get(buildingCode) || byName.get(buildingCode);
      if (building) {
        building.classrooms.push({
          id: room.id,
          name: room.name,
          room_number: roomNumber,
          capacity: room.capacity ?? null,
          has_whiteboard: true,
          has_projector: true,
          has_computers: room.has_computers ?? false,
          type: classifyRoomType(room),
          building_name: building.name,
          building_code: building.code,
          building_latitude: building.latitude,
          building_longitude: building.longitude,
          availability_times: [],
        });
      } else {
        unmatched.push({
          id: room.id,
          name: room.name,
          room_number: roomNumber,
          capacity: room.capacity ?? null,
          has_whiteboard: true,
          has_projector: true,
          has_computers: room.has_computers ?? false,
          type: classifyRoomType(room),
          availability_times: [],
          building_name: null,
          building_code: null,
          building_latitude: null,
          building_longitude: null,
        });
      }
    } else if (room.name) {
      unmatched.push({
        id: room.id,
        name: room.name,
        room_number: '',
        capacity: room.capacity ?? null,
        has_whiteboard: true,
        has_projector: true,
        has_computers: room.has_computers ?? false,
        type: classifyRoomType(room),
        availability_times: [],
        building_name: null,
        building_code: null,
        building_latitude: null,
        building_longitude: null,
      });
    }
  }

  if (Array.isArray(labeledUnmatched)) {
    for (const data of labeledUnmatched) {
      if (
        !data.building_name ||
        !data.building_code ||
        data.building_latitude == null ||
        data.building_longitude == null
      ) {
        console.warn(`Skipping classroom ${data.id} due to incomplete labeling.`);
        continue;
      }
      let building = byCode.get(data.building_code) || byName.get(data.building_name);
      if (!building) {
        building = {
          name: data.building_name || 'Unknown',
          code: data.building_code || null,
          building_id: '',
          latitude: Number(data.building_latitude || 0),
          longitude: Number(data.building_longitude || 0),
          classrooms: [],
        };
        buildings.push(building);
        if (building.code) byCode.set(building.code, building);
        byName.set(building.name, building);
      }
      building.classrooms.push({
        id: data.id,
        name: data.name,
        room_number: data.room_number || '',
        capacity: data.capacity ?? null,
        has_whiteboard: data.has_whiteboard ?? true,
        has_projector: data.has_projector ?? true,
        has_computers: data.has_computers ?? false,
        type: classifyRoomType(data),
        building_name: building.name,
        building_code: building.code,
        building_latitude: building.latitude,
        building_longitude: building.longitude,
        availability_times: Array.isArray(data.availability_times) ? data.availability_times : [],
      });
    }
  }

  return { buildings, unmatched };
}

function loadLabeledUnmatched() {
  if (fs.existsSync(LABELED_UNMATCHED)) {
    return { entries: readJson(LABELED_UNMATCHED), source: 'labeled' };
  }

  if (fs.existsSync(UNMATCHED_TO_LABEL)) {
    const data = readJson(UNMATCHED_TO_LABEL);
    const valid = [];
    const skipped = [];
    for (const entry of data) {
      if (
        entry.building_name &&
        entry.building_code &&
        entry.building_latitude != null &&
        entry.building_longitude != null
      ) {
        valid.push(entry);
      } else {
        skipped.push(entry.id);
      }
    }

    if (valid.length) {
      fs.writeFileSync(LABELED_UNMATCHED, JSON.stringify(valid, null, 2));
      console.log(`Saved ${valid.length} labeled classrooms to ${LABELED_UNMATCHED}`);
    }

    if (skipped.length) {
      console.warn(`Discarded ${skipped.length} classrooms due to incomplete labeling.`);
    }

    try {
      fs.unlinkSync(UNMATCHED_TO_LABEL);
    } catch (_) {}

    return { entries: valid, source: 'unmatched' };
  }

  return { entries: [], source: 'none' };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function fetchAvailability(classroom, startDate) {
  if (classroom?.source === 'supplemental') {
    return;
  }

  const startDatetime = `${startDate}T00:00:00`;
  const params = new URLSearchParams({
    obj_cache_accl: '0',
    start_dt: startDatetime,
    comptype: 'availability_daily',
    compsubject: 'location',
    page_size: '100',
    space_id: String(classroom.id),
    include: 'closed blackouts pending related empty',
    caller: 'pro-AvailService.getData',
  });

  const url = `https://25live.collegenet.com/25live/data/umd/run/availability/availabilitydata.json?${params.toString()}`;
  try {
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const availabilityDict = new Map();
    for (const subject of data.subjects || []) {
      const date = subject.item_date || '';
      for (const item of subject.items || []) {
        const timeStart = item.start || 'N/A';
        const timeEnd = item.end || 'N/A';
        const key = `${date}|${timeStart}|${timeEnd}`;
        if (!availabilityDict.has(key)) {
          availabilityDict.set(key, {
            date,
            event_name: [item.itemName || 'N/A'],
            time_start: timeStart,
            time_end: timeEnd,
            status: item.type_id ?? 'N/A',
            additional_details: [item.itemId2 || 'N/A'],
          });
        } else {
          const entry = availabilityDict.get(key);
          entry.event_name.push(item.itemName || 'N/A');
          entry.additional_details.push(item.itemId2 || 'N/A');
        }
      }
    }

    const availability = [];
    for (const entry of availabilityDict.values()) {
      availability.push({
        ...entry,
        event_name: entry.event_name.join(', '),
        additional_details: entry.additional_details.map(String).join(', '),
      });
    }

    classroom.availability_times = availability;
  } catch (err) {
    console.warn(`Availability fetch failed for ${classroom.id}: ${err.message}`);
    classroom.availability_times = [];
  }
}

async function runPool(items, worker, limit) {
  let idx = 0;
  const executing = new Set();

  async function enqueue() {
    if (idx >= items.length) return;
    const item = items[idx++];
    const p = Promise.resolve()
      .then(() => worker(item))
      .finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
    await enqueue();
  }

  await enqueue();
  await Promise.all(executing);
}

async function main() {
  const startDate = process.env.AVAIL_START_DATE || getTodayInEastern();

  if (!FORCE_REFRESH && fileFreshEnough(OUTPUT_JSON)) {
    if (cachedFileCoversStartDate(OUTPUT_JSON, startDate)) {
      writeMetadataFile(readJson(OUTPUT_JSON));
      console.log(
        `Using cached buildings_data.json (fresh within ${CACHE_HOURS}h and covers ${startDate})`
      );
      return;
    }
    console.log(
      `Cached buildings_data.json is fresh but does not cover ${startDate}; refreshing data.`
    );
  }

  if (!fs.existsSync(BUILDINGS_JSON)) {
    console.error('Missing buildings.json. Skipping data refresh.');
    return;
  }

  console.log('Loading building metadata...');
  const buildingsData = readJson(BUILDINGS_JSON);
  let roomsData;
  try {
    roomsData = await fetchRoomIdsFrom25Live(buildingsData);
    if (!Array.isArray(roomsData) || !roomsData.length) {
      throw new Error('25Live returned no rooms');
    }
    fs.writeFileSync(ROOMS_JSON, JSON.stringify(roomsData, null, 2));
    console.log(`Fetched ${roomsData.length} live rooms from 25Live.`);
  } catch (error) {
    console.warn(`Falling back to cached room_ids.json: ${error.message}`);
    roomsData = loadRoomsData().filter((room) => !ROOMS_TO_REMOVE.has(String(room.name || '').trim()));
  }
  const labeledUnmatched = loadLabeledUnmatched();

  const { buildings, unmatched } = buildBuildings(
    buildingsData,
    roomsData,
    labeledUnmatched.entries
  );

  await appendSupplementalSpaces(buildings, startDate);

  const classrooms = buildings.flatMap((b) => b.classrooms);
  const allClassrooms = classrooms.concat(unmatched);
  const total = allClassrooms.length;
  if (!total) {
    console.warn('No classrooms found. Skipping data refresh.');
    return;
  }

  console.log(`Fetching availability for ${total} rooms (start date ${startDate})...`);

  let completed = 0;
  await runPool(
    allClassrooms,
    async (room) => {
      await fetchAvailability(room, startDate);
      completed += 1;
      if (completed % 25 === 0 || completed === total) {
        process.stdout.write(`\rProgress: ${completed}/${total}`);
      }
    },
    MAX_WORKERS
  );
  process.stdout.write('\n');

  const buildingsWithRooms = buildings.filter((b) => b.classrooms && b.classrooms.length);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(buildingsWithRooms, null, 2));
  writeMetadataFile(buildingsWithRooms);
  console.log(`Wrote ${OUTPUT_JSON}`);

  if (labeledUnmatched.source === 'none' && unmatched.length) {
    fs.writeFileSync(UNMATCHED_TO_LABEL, JSON.stringify(unmatched, null, 2));
    console.warn(
      `Unmatched classrooms exported to ${UNMATCHED_TO_LABEL}. ` +
        'Add building info and rerun to include them.'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
