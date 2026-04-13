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
const SUPPLEMENTAL_RANGE_DAYS = 31;
const ROOMS_TO_REMOVE = new Set(['JMZ 1123 (Loss)']);
const DEFAULT_LOFT_CALENDAR_ID =
  'c_85b8aaf1fab1942f8c8c5f5fcbffdfb91d85de1cfef92c8a4918668c403a93b2@group.calendar.google.com';
const DEFAULT_AVW_CALENDARS = [
  {
    roomName: 'AVW 1442',
    roomNumber: '1442',
    calendarId: 'c_188bj2ec253hailij4gfm1n6c7i4e@resource.calendar.google.com',
    capacity: 26,
    accessNote: 'ECE/ISR/ENTS faculty, staff, and students',
  },
  {
    roomName: 'AVW 1454',
    roomNumber: '1454',
    calendarId: 'c_1884g7v449bvijc9l4sha6ft552rk@resource.calendar.google.com',
    capacity: 12,
    accessNote: 'ECE/ISR/ENTS faculty, staff, and students unless reserved',
  },
  {
    roomName: 'AVW 2446',
    roomNumber: '2446',
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
    source_url: ENGINEERING_LABS_URL,
    source_label: 'Official Lab Info',
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
    details_note: '24/7 except holidays',
    source_url: ENGINEERING_LABS_URL,
    source_label: 'Official Lab Info',
    supplemental: {
      mode: 'hours',
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
    details_note: '24/7',
    source_url: ENGINEERING_LABS_URL,
    source_label: 'Official Lab Info',
    supplemental: {
      mode: 'hours',
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
    source_url: ENGINEERING_LABS_URL,
    source_label: 'Official Lab Info',
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
    details_note: 'Open 7 AM-6 PM Monday-Friday',
    source_url: ENGINEERING_LABS_URL,
    source_label: 'Official Lab Info',
    supplemental: {
      mode: 'hours',
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
    details_note: 'Open 7 AM-6 PM Monday-Friday',
    source_url: ENGINEERING_LABS_URL,
    source_label: 'Official Lab Info',
    supplemental: {
      mode: 'hours',
      hours: { type: 'weekday-window', start: 7, end: 18 },
    },
  },
];

async function fetchRoomIdsFrom25Live(buildingsData) {
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
      for (const room of rowEntry.row || []) {
        if (!room || typeof room !== 'object') continue;
        const id = room.itemId;
        const name = room.itemName;
        if (!id || !name || seen.has(String(id)) || buildingIdSet.has(String(id))) continue;
        seen.add(String(id));
        rooms.push({ id, name });
        addedThisPage += 1;
      }
    }

    if (addedThisPage < pageSize) {
      break;
    }
  }

  return rooms.filter((room) => !ROOMS_TO_REMOVE.has(String(room.name || '').trim()));
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

function unfoldIcsLines(icsText) {
  return String(icsText || '')
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/);
}

function parseIcsDateValue(rawValue) {
  if (!rawValue) return null;
  const value = String(rawValue).trim();
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return { kind: 'datetime', date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)) };
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return { kind: 'datetime-local', date: new Date(year, month - 1, day, hour, minute, second) };
  }
  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return { kind: 'date', dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
  }
  return null;
}

function parseGoogleCalendarBusyEvents(icsText, startDateKey, days = SUPPLEMENTAL_RANGE_DAYS) {
  const startDate = parseDateKey(startDateKey);
  const rangeEnd = new Date(startDate);
  rangeEnd.setDate(rangeEnd.getDate() + days);
  const rangeEndKey = formatDateKey(rangeEnd);
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.dtStart && current?.dtEnd) {
        events.push(current);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    if (key.startsWith('DTSTART')) {
      current.dtStart = parseIcsDateValue(value);
    } else if (key.startsWith('DTEND')) {
      current.dtEnd = parseIcsDateValue(value);
    } else if (key === 'SUMMARY') {
      current.summary = value || 'Busy';
    }
  }

  const availability = [];
  for (const event of events) {
    if (event.dtStart.kind === 'date' && event.dtEnd.kind === 'date') {
      let cursor = event.dtStart.dateKey;
      while (cursor < event.dtEnd.dateKey) {
        if (cursor >= startDateKey && cursor < rangeEndKey) {
          availability.push({
            date: `${cursor}T00:00:00`,
            event_name: event.summary || 'Busy',
            time_start: formatDecimal(0),
            time_end: formatDecimal(24),
            status: 1,
            additional_details: 'calendar',
          });
        }
        cursor = shiftDateKey(cursor, 1);
      }
      continue;
    }

    if (!event.dtStart.date || !event.dtEnd.date) continue;
    let cursor = new Date(event.dtStart.date);
    while (cursor < event.dtEnd.date) {
      const dayStart = new Date(cursor);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const segmentStart = event.dtStart.date > dayStart ? event.dtStart.date : dayStart;
      const segmentEnd = event.dtEnd.date < dayEnd ? event.dtEnd.date : dayEnd;
      if (segmentEnd > segmentStart) {
        const startParts = getEasternParts(segmentStart);
        const endParts = getEasternParts(new Date(segmentEnd.getTime() - 1000));
        const sameDate = startParts.dateKey === endParts.dateKey;
        const dateKey = startParts.dateKey;
        if (dateKey >= startDateKey && dateKey < rangeEndKey) {
          const startDecimal = decimalHour(startParts.hour, startParts.minute);
          const rawEndDecimal = decimalHour(endParts.hour, endParts.minute + 1);
          const endDecimal = sameDate ? rawEndDecimal : 24;
          availability.push({
            date: `${dateKey}T00:00:00`,
            event_name: event.summary || 'Busy',
            time_start: formatDecimal(startDecimal),
            time_end: formatDecimal(Math.min(24, endDecimal)),
            status: 1,
            additional_details: 'calendar',
          });
        }
      }
      cursor = dayEnd;
    }
  }

  return availability
    .filter((slot) => Number(slot.time_end) > Number(slot.time_start))
    .sort((a, b) => `${a.date}|${a.time_start}`.localeCompare(`${b.date}|${b.time_start}`));
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
    if (hours.type === 'weekday-window') {
      if (day === 0 || day === 6) {
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
      if (hours.start > 7) {
        availability.push({
          date: `${dateKey}T00:00:00`,
          event_name: 'Closed',
          time_start: formatDecimal(7),
          time_end: formatDecimal(hours.start),
          status: 1,
          additional_details: 'supplemental-hours',
        });
      }
      if (hours.end < 22) {
        availability.push({
          date: `${dateKey}T00:00:00`,
          event_name: 'Closed',
          time_start: formatDecimal(hours.end),
          time_end: formatDecimal(22),
          status: 1,
          additional_details: 'supplemental-hours',
        });
      }
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
    has_whiteboard: false,
    has_projector: false,
    has_computers: base.has_computers ?? false,
    type: base.type || 'Classroom',
    access_note: base.access_note || null,
    details_note: base.details_note || null,
    source_url: base.source_url || null,
    source_label: base.source_label || null,
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
          source_url: ENGINEERING_LABS_URL,
          source_label: 'Official Lab Calendar',
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
        ? await fetchCalendarAvailability(calendarId, startDateKey)
        : [];
    } catch (error) {
      console.warn(`Supplemental calendar fetch failed for ${room.name}: ${error.message}`);
      room.availability_times = [];
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
    const availabilityTimes = createSupplementalBusyEvents(startDateKey, base.supplemental);
    const room = buildSupplementalRoom(base, building, availabilityTimes);
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
          capacity: null,
          has_whiteboard: true,
          has_projector: true,
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
          capacity: null,
          has_whiteboard: true,
          has_projector: true,
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
        capacity: null,
        has_whiteboard: true,
        has_projector: true,
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
