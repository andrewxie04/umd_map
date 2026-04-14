import { formatInTimeZone } from 'date-fns-tz';

export const CAMPUS_TIME_ZONE = 'America/New_York';
const FUNCTION_ENDPOINT = '/.netlify/functions/availability-building';

export function getDateKey(date) {
  return formatInTimeZone(date, CAMPUS_TIME_ZONE, 'yyyy-MM-dd');
}

export function getCoverageRange(buildings) {
  let minDate = null;
  let maxDate = null;

  for (const building of buildings || []) {
    for (const room of building.classrooms || []) {
      for (const slot of room.availability_times || []) {
        const date = String(slot.date || '').split('T')[0];
        if (!date) continue;
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    }
  }

  return minDate && maxDate ? { minDate, maxDate } : null;
}

export function isDateCovered(dateKey, coverage) {
  if (!coverage || !coverage.minDate || !coverage.maxDate) return false;
  return dateKey >= coverage.minDate && dateKey <= coverage.maxDate;
}

export function stripAvailability(buildings) {
  return (buildings || []).map((building) => ({
    ...building,
    classrooms: (building.classrooms || []).map((room) => ({
      ...room,
      availability_times: [],
    })),
  }));
}

export async function fetchJsonWithProgress(url, { signal, onProgress } = {}) {
  const response = await fetch(url, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);

  if (!response.body) {
    const data = await response.json();
    onProgress?.({ loaded: 1, total: 1, ratio: 1, indeterminate: true });
    return data;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress?.({
        loaded,
        total: contentLength,
        ratio: contentLength ? loaded / contentLength : null,
        indeterminate: !contentLength,
      });
    }
  }

  onProgress?.({
    loaded: contentLength || loaded || 1,
    total: contentLength || loaded || 1,
    ratio: 1,
    indeterminate: !contentLength,
  });

  const blob = new Blob(chunks);
  const text = await blob.text();
  return JSON.parse(text);
}

async function fetchBuildingAvailability(building, dateKey, signal) {
  const response = await fetch(FUNCTION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      date: dateKey,
      building,
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function fetchAvailabilityForDate(
  buildings,
  date,
  { signal, onProgress, concurrency = 4 } = {}
) {
  const dateKey = typeof date === 'string' ? date : getDateKey(date);
  const tasks = (buildings || []).map((building, index) => ({
    index,
    roomCount: (building.classrooms || []).length,
    building,
  }));
  const totalRooms = tasks.reduce((sum, task) => sum + task.roomCount, 0);
  const totalBuildings = tasks.length;
  const results = new Array(totalBuildings);

  let completedRooms = 0;
  let completedBuildings = 0;
  let cursor = 0;

  onProgress?.({
    completedRooms,
    totalRooms,
    completedBuildings,
    totalBuildings,
    ratio: totalRooms ? 0 : 1,
    indeterminate: false,
  });

  const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

  async function worker() {
    while (cursor < tasks.length) {
      if (signal?.aborted) throw abortError();
      const task = tasks[cursor++];
      const result = await fetchBuildingAvailability(task.building, dateKey, signal);
      results[task.index] = result;
      completedRooms += task.roomCount;
      completedBuildings += 1;
      onProgress?.({
        completedRooms,
        totalRooms,
        completedBuildings,
        totalBuildings,
        ratio: totalRooms ? completedRooms / totalRooms : 1,
        indeterminate: false,
      });
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, tasks.length || 1));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return results.map((building, index) => building || tasks[index].building);
}
