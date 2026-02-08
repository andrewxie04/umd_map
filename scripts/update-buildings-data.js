/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.resolve(ROOT, '..', 'UMD_api');

const BUILDINGS_JSON = path.join(API_DIR, 'buildings.json');
const ROOMS_JSON = path.join(API_DIR, 'room_ids.json');
const LABELED_UNMATCHED = path.join(API_DIR, 'labeled_unmatched_classrooms.json');
const OUTPUT_JSON = path.join(ROOT, 'public', 'buildings_data.json');

const MAX_WORKERS = Number(process.env.AVAIL_MAX_WORKERS || 25);
const CACHE_HOURS = Number(process.env.AVAIL_CACHE_HOURS || 6);
const FORCE_REFRESH = process.env.AVAIL_FORCE_REFRESH === '1';

function fileFreshEnough(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < CACHE_HOURS * 60 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
        });
      }
    } else if (room.name) {
      unmatched.push({ id: room.id, name: room.name, room_number: '' });
    }
  }

  if (Array.isArray(labeledUnmatched)) {
    for (const data of labeledUnmatched) {
      if (!data.building_name || !data.building_code) continue;
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
        building_name: building.name,
        building_code: building.code,
        building_latitude: building.latitude,
        building_longitude: building.longitude,
        availability_times: Array.isArray(data.availability_times) ? data.availability_times : [],
      });
    }
  }

  return buildings;
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
  if (!FORCE_REFRESH && fileFreshEnough(OUTPUT_JSON)) {
    console.log(`Using cached buildings_data.json (fresh within ${CACHE_HOURS}h)`);
    return;
  }

  if (!fs.existsSync(BUILDINGS_JSON) || !fs.existsSync(ROOMS_JSON)) {
    console.error('Missing buildings.json or room_ids.json. Skipping data refresh.');
    return;
  }

  console.log('Loading building metadata...');
  const buildingsData = readJson(BUILDINGS_JSON);
  const roomsData = readJson(ROOMS_JSON);
  const labeledUnmatched = fs.existsSync(LABELED_UNMATCHED) ? readJson(LABELED_UNMATCHED) : [];

  const buildings = buildBuildings(buildingsData, roomsData, labeledUnmatched);
  const classrooms = buildings.flatMap((b) => b.classrooms);
  const total = classrooms.length;
  if (!total) {
    console.warn('No classrooms found. Skipping data refresh.');
    return;
  }

  const startDate = getTodayInEastern();
  console.log(`Fetching availability for ${total} rooms (start date ${startDate})...`);

  let completed = 0;
  await runPool(
    classrooms,
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
  console.log(`Wrote ${OUTPUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
