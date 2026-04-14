// src/availability.js

import { toZonedTime, format } from 'date-fns-tz';

// Fixed-date holidays (MM-dd, year-agnostic)
const FIXED_HOLIDAYS = [
  '01-01', // New Year's Day
  '06-19', // Juneteenth
  '07-04', // Independence Day
  '12-24', // Christmas Eve
  '12-25', // Christmas Day
  '12-31', // New Year's Eve
];

// Returns the date of the nth occurrence of a weekday in a given month/year
// weekday: 0=Sun … 6=Sat, n: 1-based (1=first, -1=last)
function nthWeekdayOf(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(year, month, 1);
    const diff = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month, 1 + diff + (n - 1) * 7);
  }
  // last occurrence
  const last = new Date(year, month + 1, 0);
  const diff = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month + 1, -diff);
}

function getFloatingHolidays(year) {
  return [
    nthWeekdayOf(year, 0, 1, 3),      // MLK Day — 3rd Monday in Jan
    nthWeekdayOf(year, 4, 1, -1),      // Memorial Day — last Monday in May
    nthWeekdayOf(year, 8, 1, 1),       // Labor Day — 1st Monday in Sep
    nthWeekdayOf(year, 10, 4, 4),      // Thanksgiving — 4th Thursday in Nov
    (() => {                           // Day after Thanksgiving
      const thx = nthWeekdayOf(year, 10, 4, 4);
      return new Date(year, thx.getMonth(), thx.getDate() + 1);
    })(),
  ].map((d) => format(d, 'MM-dd'));
}

const OPERATING_START_HOUR = 7;  // 7 AM
const OPERATING_END_HOUR = 22;   // 10 PM
const OPENING_SOON_MINUTES = 60;
const MIN_USEFUL_OPEN_WINDOW_MINUTES = 30;

function isLibCalRoom(room) {
  return room?.source === 'libcal' && room?.libcal;
}

export function isSupplementalRoom(room) {
  return room?.source === 'supplemental' && room?.supplemental;
}

function getSupplementalHours(room) {
  return room?.supplemental?.hours || { type: 'weekday-window', start: 7, end: 22 };
}

function getSupplementalOpenWindows(room, dateToCheck) {
  const hours = getSupplementalHours(room);

  if (hours.holidayClosed && isUniversityHoliday(dateToCheck)) {
    return [];
  }

  if (hours.type === 'always') {
    return [{ start: 0, end: 24 }];
  }

  if (hours.type === 'weekday-window') {
    const dayOfWeek = dateToCheck.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return [];
    }
    return [{ start: hours.start ?? 7, end: hours.end ?? 22 }];
  }

  if (hours.type === 'weekly-windows') {
    const dayOfWeek = dateToCheck.getDay();
    return Array.isArray(hours.windows?.[dayOfWeek])
      ? hours.windows[dayOfWeek]
          .map((window) => ({
            start: Number(window.start),
            end: Number(window.end),
          }))
          .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
      : [];
  }

  return [{ start: 7, end: 22 }];
}

export function getSupplementalOpenRange(room, dateToCheck) {
  return getSupplementalOpenWindows(room, dateToCheck)[0] || null;
}

export function getSupplementalAvailableBlocks(room, dateToCheck) {
  const openWindows = getSupplementalOpenWindows(room, dateToCheck);
  if (!openWindows.length) {
    return [];
  }

  const busyBlocks = getBookedBlocks(room, dateToCheck)
    .sort((a, b) => a.start - b.start);

  const availableBlocks = [];
  for (const window of openWindows) {
    const clippedBusyBlocks = busyBlocks
      .map((block) => ({
        start: Math.max(window.start, block.start),
        end: Math.min(window.end, block.end),
      }))
      .filter((block) => block.end > block.start);

    if (!clippedBusyBlocks.length) {
      availableBlocks.push({ start: window.start, end: window.end });
      continue;
    }

    let cursor = window.start;
    for (const block of clippedBusyBlocks) {
      if (block.start > cursor) {
        availableBlocks.push({ start: cursor, end: block.start });
      }
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < window.end) {
      availableBlocks.push({ start: cursor, end: window.end });
    }
  }

  return availableBlocks.filter((block) => block.end > block.start);
}

function getSupplementalNextAvailableInfo(room, currentDateTime = null) {
  if (!isSupplementalRoom(room)) return null;

  const timeZone = 'America/New_York';
  const now = currentDateTime
    ? toZonedTime(currentDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const availableBlocks = getSupplementalAvailableBlocks(room, now);
  const nextBlock = availableBlocks.find((block) => block.start > currentHour);

  if (!nextBlock) return null;

  return {
    opensAt: formatDecimalHour(nextBlock.start),
    closesAt: formatDecimalHour(nextBlock.end),
    opensInMinutes: Math.round((nextBlock.start - currentHour) * 60),
    availableForMinutes: Math.round((nextBlock.end - nextBlock.start) * 60),
    block: nextBlock,
  };
}

/**
 * Debug function to log availability calculation steps
 */
export function debugClassroomAvailability(room, selectedStartDateTime, selectedEndDateTime) {
  const debug = getClassroomAvailability(room, selectedStartDateTime, selectedEndDateTime, true);
  if (process.env.NODE_ENV !== 'production') {
    console.debug('Availability Debug:', debug);
  }
  return debug.status;
}

/**
 * Checks if a given date is a university holiday.
 */
export function isUniversityHoliday(date) {
  const md = format(date, 'MM-dd', { timeZone: 'America/New_York' });
  if (FIXED_HOLIDAYS.includes(md)) return true;
  const year = parseInt(format(date, 'yyyy', { timeZone: 'America/New_York' }), 10);
  return getFloatingHolidays(year).includes(md);
}

/**
 * Converts decimal hours to a Date object
 */
function decimalHoursToDate(date, decimalHours) {
  const decimal = parseFloat(decimalHours);
  const hours = Math.floor(decimal);
  const minutes = Math.round((decimal - hours) * 60);

  const eventDate = new Date(date);
  eventDate.setHours(hours, minutes, 0, 0);
  return eventDate;
}

function getDateOperatingContext(currentStartTime, selectedStartDateTime, selectedEndDateTime) {
  const timeZone = 'America/New_York';
  const currentEndTime = selectedEndDateTime
    ? toZonedTime(selectedEndDateTime, timeZone)
    : currentStartTime;
  const dateToCheck = new Date(currentStartTime);
  const dayOfWeek = dateToCheck.getDay();
  const currentHour = currentStartTime.getHours() + currentStartTime.getMinutes() / 60;
  const endHour = currentEndTime.getHours() + currentEndTime.getMinutes() / 60;
  const hasRange =
    selectedStartDateTime &&
    selectedEndDateTime &&
    currentEndTime > currentStartTime;

  return {
    currentEndTime,
    dateToCheck,
    dayOfWeek,
    currentHour,
    endHour,
    hasRange,
  };
}

export function getBookedBlocks(room, dateToCheck, options = {}) {
  const { detailsFilter = null } = options;
  const timeZone = 'America/New_York';
  const dateString = format(dateToCheck, 'yyyy-MM-dd', { timeZone });
  const events = (room.availability_times || [])
    .filter((timeRange) => {
      const eventDatePart = String(timeRange.date || '').split('T')[0];
      if (eventDatePart !== dateString || timeRange.status !== 1) {
        return false;
      }
      return typeof detailsFilter === 'function' ? detailsFilter(timeRange) : true;
    })
    .map((timeRange) => ({
      ...timeRange,
      start: parseFloat(timeRange.time_start),
      end: parseFloat(timeRange.time_end),
    }))
    .filter((timeRange) => Number.isFinite(timeRange.start) && Number.isFinite(timeRange.end))
    .sort((a, b) => a.start - b.start);

  if (events.length === 0) return [];

  const merged = [];
  for (const event of events) {
    const last = merged[merged.length - 1];
    if (!last || event.start > last.end + 1e-6) {
      merged.push({ start: event.start, end: event.end, events: [event] });
      continue;
    }
    last.end = Math.max(last.end, event.end);
    last.events.push(event);
  }

  return merged;
}

export function getSupplementalReservationBlocks(room, dateToCheck) {
  return getBookedBlocks(room, dateToCheck, {
    detailsFilter: (timeRange) => String(timeRange.additional_details || '') === 'calendar',
  });
}

function getLibCalAvailableBlocks(room, dateToCheck) {
  const dateString = format(dateToCheck, 'yyyy-MM-dd', { timeZone: 'America/New_York' });
  return (room?.libcal?.available_blocks || [])
    .filter((block) => String(block.date || '').split('T')[0] === dateString)
    .map((block) => ({
      ...block,
      time_start: Number(block.time_start),
      time_end: Number(block.time_end),
    }))
    .filter((block) => Number.isFinite(block.time_start) && Number.isFinite(block.time_end))
    .sort((a, b) => a.time_start - b.time_start);
}

function normalizeLibCalRange(startHour, endHour) {
  const safeStart = Number(startHour);
  const safeEnd = Number(endHour);
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) {
    return null;
  }

  return {
    start: safeStart,
    end: safeEnd <= safeStart ? safeEnd + 24 : safeEnd,
  };
}

function normalizeLibCalHour(currentHour, startHour) {
  return currentHour < startHour ? currentHour + 24 : currentHour;
}

function getLibCalCurrentBlock(room, currentDateTime) {
  const timeZone = 'America/New_York';
  const currentTime = currentDateTime
    ? toZonedTime(currentDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);
  const currentHour = currentTime.getHours() + currentTime.getMinutes() / 60;
  const blocks = getLibCalAvailableBlocks(room, currentTime);
  return (
    blocks.find((block) => {
      const range = normalizeLibCalRange(block.time_start, block.time_end);
      if (!range) return false;
      const normalizedHour = normalizeLibCalHour(currentHour, range.start);
      return normalizedHour >= range.start && normalizedHour < range.end;
    }) || null
  );
}

export function getLibCalNextAvailableInfo(room, currentDateTime = null) {
  if (!isLibCalRoom(room)) return null;

  const timeZone = 'America/New_York';
  const now = currentDateTime
    ? toZonedTime(currentDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const nextBlock = getLibCalAvailableBlocks(room, now).find((block) => {
    const range = normalizeLibCalRange(block.time_start, block.time_end);
    return range && range.start > currentHour;
  });

  if (!nextBlock) return null;

  return {
    opensAt: formatDecimalHour(nextBlock.time_start),
    closesAt: formatDecimalHour(nextBlock.time_end),
    opensInMinutes: Math.round((nextBlock.time_start - currentHour) * 60),
    availableForMinutes: Math.round((nextBlock.time_end - nextBlock.time_start) * 60),
    block: nextBlock,
  };
}

export function getOpeningSoonInfo(
  room,
  currentDateTime = null,
  thresholdMinutes = OPENING_SOON_MINUTES,
  minimumOpenMinutes = MIN_USEFUL_OPEN_WINDOW_MINUTES
) {
  const timeZone = 'America/New_York';
  const now = currentDateTime
    ? toZonedTime(currentDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);

  if (isLibCalRoom(room)) {
    const nextBlock = getLibCalNextAvailableInfo(room, now);
    if (!nextBlock) return null;

    const opensInMinutes = nextBlock.opensInMinutes;
    if (opensInMinutes < 0 || opensInMinutes > thresholdMinutes) return null;
    if (nextBlock.availableForMinutes < minimumOpenMinutes) return null;

    return {
      opensAt: nextBlock.opensAt,
      opensInMinutes,
      availableForMinutes: nextBlock.availableForMinutes,
    };
  }

  if (isSupplementalRoom(room)) {
    const nextBlock = getSupplementalNextAvailableInfo(room, now);
    if (!nextBlock) return null;

    const opensInMinutes = nextBlock.opensInMinutes;
    if (opensInMinutes < 0 || opensInMinutes > thresholdMinutes) return null;
    if (nextBlock.availableForMinutes < minimumOpenMinutes) return null;

    return {
      opensAt: nextBlock.opensAt,
      opensInMinutes,
      availableForMinutes: nextBlock.availableForMinutes,
    };
  }

  if (isUniversityHoliday(now)) return null;
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  const currentHour = now.getHours() + now.getMinutes() / 60;
  if (currentHour < OPERATING_START_HOUR || currentHour >= OPERATING_END_HOUR) return null;
  const blocks = getBookedBlocks(room, now);
  const currentBlock = blocks.find((block) => currentHour >= block.start && currentHour < block.end);

  if (!currentBlock || currentBlock.end >= OPERATING_END_HOUR) return null;

  const opensInMinutes = Math.round((currentBlock.end - currentHour) * 60);
  if (opensInMinutes < 0 || opensInMinutes > thresholdMinutes) return null;
  const nextBlock = blocks.find((block) => block.start >= currentBlock.end - 1e-6);
  const nextBusyStart = nextBlock ? nextBlock.start : OPERATING_END_HOUR;
  const availableWindowMinutes = Math.round((nextBusyStart - currentBlock.end) * 60);
  if (availableWindowMinutes < minimumOpenMinutes) return null;

  return {
    opensAt: formatDecimalHour(currentBlock.end),
    opensInMinutes,
    availableForMinutes: availableWindowMinutes,
  };
}

/**
 * Enhanced classroom availability checker with optional debugging
 */
export function getClassroomAvailability(
  room,
  selectedStartDateTime = null,
  selectedEndDateTime = null,
  debug = false
) {
  const timeZone = 'America/New_York';
  const debugInfo = debug ? { steps: [], events: [] } : null;

  // Get current times
  const currentStartTime = selectedStartDateTime
    ? toZonedTime(selectedStartDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);

  // When checking current availability, we only need to check the current moment
  const {
    currentEndTime,
    dateToCheck,
    dayOfWeek,
    currentHour,
    endHour,
    hasRange,
  } = getDateOperatingContext(currentStartTime, selectedStartDateTime, selectedEndDateTime);

  if (debug) {
    debugInfo.steps.push({
      step: 'Times',
      requested: {
        start: currentStartTime.toISOString(),
        end: currentEndTime.toISOString()
      }
    });
  }

  if (isLibCalRoom(room)) {
    const libCalBlocks = getLibCalAvailableBlocks(room, currentStartTime);

    if (debug) {
      debugInfo.steps.push({
        step: 'LibCalBlocks',
        availableBlocks: libCalBlocks.length,
      });
    }

    if (!libCalBlocks.length) {
      return debug ? { status: 'Unavailable', reason: 'No Bookable Slots', debug: debugInfo } : 'Unavailable';
    }

    const currentBlock = libCalBlocks.find((block) => {
      const range = normalizeLibCalRange(block.time_start, block.time_end);
      if (!range) return false;
      const normalizedHour = normalizeLibCalHour(currentHour, range.start);
      return normalizedHour >= range.start && normalizedHour < range.end;
    });

    if (selectedStartDateTime && selectedEndDateTime && currentEndTime > currentStartTime) {
      const matchingBlock = libCalBlocks.find((block) => {
        const range = normalizeLibCalRange(block.time_start, block.time_end);
        if (!range) return false;
        const normalizedStartHour = normalizeLibCalHour(currentHour, range.start);
        const normalizedEndHour = normalizeLibCalHour(endHour, range.start);
        return normalizedStartHour >= range.start && normalizedEndHour <= range.end;
      });
      return debug
        ? {
            status: matchingBlock ? 'Available' : 'Unavailable',
            reason: matchingBlock ? 'Inside Bookable Block' : 'Requested Time Not Bookable',
            debug: debugInfo,
          }
        : matchingBlock
          ? 'Available'
          : 'Unavailable';
    }

    if (currentBlock) {
      return debug ? { status: 'Available', reason: 'Inside Bookable Block', debug: debugInfo } : 'Available';
    }

    const openingSoon = getOpeningSoonInfo(room, currentStartTime);
    if (openingSoon) {
      return debug ? { status: 'Opening Soon', reason: 'Next Bookable Block Starts Soon', debug: debugInfo } : 'Opening Soon';
    }

    return debug ? { status: 'Unavailable', reason: 'Outside Bookable Blocks', debug: debugInfo } : 'Unavailable';
  }

  if (isSupplementalRoom(room)) {
    const availableBlocks = getSupplementalAvailableBlocks(room, currentStartTime);

    if (debug) {
      debugInfo.steps.push({
        step: 'SupplementalBlocks',
        availableBlocks: availableBlocks.length,
      });
    }

    if (!availableBlocks.length) {
      const closedReason = getSupplementalOpenRange(room, currentStartTime) ? 'No Open Block' : 'Outside Supplemental Hours';
      return debug ? { status: 'Closed', reason: closedReason, debug: debugInfo } : 'Closed';
    }

    if (selectedStartDateTime && selectedEndDateTime && currentEndTime > currentStartTime) {
      const matchingBlock = availableBlocks.find(
        (block) => currentHour >= block.start && endHour <= block.end
      );
      return debug
        ? {
            status: matchingBlock ? 'Available' : 'Unavailable',
            reason: matchingBlock ? 'Inside Supplemental Open Block' : 'Requested Time Not Open',
            debug: debugInfo,
          }
        : matchingBlock
          ? 'Available'
          : 'Unavailable';
    }

    const currentBlock = availableBlocks.find(
      (block) => currentHour >= block.start && currentHour < block.end
    );

    if (currentBlock) {
      return debug ? { status: 'Available', reason: 'Inside Supplemental Open Block', debug: debugInfo } : 'Available';
    }

    const openingSoon = getOpeningSoonInfo(room, currentStartTime);
    if (openingSoon) {
      return debug ? { status: 'Opening Soon', reason: 'Supplemental Space Opens Soon', debug: debugInfo } : 'Opening Soon';
    }

    return debug ? { status: 'Unavailable', reason: 'Outside Supplemental Open Blocks', debug: debugInfo } : 'Unavailable';
  }

  // Check weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return debug ? { status: 'Closed', reason: 'Weekend' } : 'Closed';
  }

  // Check holidays
  if (isUniversityHoliday(dateToCheck)) {
    return debug ? { status: 'Closed', reason: 'Holiday' } : 'Closed';
  }

  // Check operating hours
  if (hasRange) {
    const startDateStr = format(currentStartTime, 'yyyy-MM-dd', { timeZone });
    const endDateStr = format(currentEndTime, 'yyyy-MM-dd', { timeZone });
    if (startDateStr !== endDateStr) {
      return debug ? { status: 'Closed', reason: 'Outside Operating Hours' } : 'Closed';
    }
    if (
      currentHour < OPERATING_START_HOUR ||
      endHour > OPERATING_END_HOUR ||
      endHour <= currentHour
    ) {
      return debug ? { status: 'Closed', reason: 'Outside Operating Hours' } : 'Closed';
    }
  } else {
    if (currentHour < OPERATING_START_HOUR || currentHour >= OPERATING_END_HOUR) {
      return debug ? { status: 'Closed', reason: 'Outside Operating Hours' } : 'Closed';
    }
  }

  // Check if availability data exists
  if (!room.availability_times || !Array.isArray(room.availability_times)) {
    return debug ? { status: 'Available', reason: 'No Schedule Data' } : 'Available';
  }

  // Get events for the date and with status:1
  const todayAvailability = getBookedBlocks(room, dateToCheck).flatMap((block) => block.events);

  if (todayAvailability.length === 0) {
    return debug ? { status: 'Available', reason: 'No Events Today' } : 'Available';
  }

  // Check for overlapping events
  const overlappingEvents = todayAvailability.filter((timeRange) => {
    const eventStartDecimal = parseFloat(timeRange.time_start);
    const eventEndDecimal = parseFloat(timeRange.time_end);

    const eventStart = decimalHoursToDate(currentStartTime, eventStartDecimal);
    const eventEnd = decimalHoursToDate(currentStartTime, eventEndDecimal);

    if (selectedStartDateTime && selectedEndDateTime) {
      // For scheduled time slots, check if the requested time range overlaps with any events
      return !(currentEndTime <= eventStart || currentStartTime >= eventEnd);
    } else {
      // For "now" view, just check if current time falls within event
      return currentStartTime >= eventStart && currentStartTime < eventEnd;
    }
  });

  if (debug) {
    debugInfo.steps.push({
      step: 'Events',
      totalEvents: todayAvailability.length,
      overlappingEvents: overlappingEvents.length
    });

    debugInfo.events = overlappingEvents.map((event) => ({
      event: event.event_name,
      eventTime: `${event.time_start} - ${event.time_end}`,
      currentTime: currentHour,
      overlaps: true
    }));

    return {
      status: overlappingEvents.length === 0 ? 'Available' : 'Unavailable',
      reason: overlappingEvents.length === 0 ? 'No Conflicts' : 'Conflicting Events',
      debug: debugInfo
    };
  }

  if (overlappingEvents.length === 0) return 'Available';

  if (!selectedStartDateTime && !selectedEndDateTime) {
    const openingSoon = getOpeningSoonInfo(room, currentStartTime);
    if (openingSoon) return 'Opening Soon';
  }

  return 'Unavailable';
}

/**
 * Checks building availability
 */
export function getBuildingAvailability(
  classrooms,
  selectedStartDateTime = null,
  selectedEndDateTime = null
) {
  if (!Array.isArray(classrooms) || classrooms.length === 0) {
    return 'No Data';
  }

  let allClosed = true;
  let hasOpeningSoon = false;
  for (const room of classrooms) {
    const status = getClassroomAvailability(room, selectedStartDateTime, selectedEndDateTime);
    if (status === 'Available') return 'Available';
    if (status === 'Opening Soon') hasOpeningSoon = true;
    if (status !== 'Closed') allClosed = false;
  }

  if (hasOpeningSoon) return 'Opening Soon';
  return allClosed ? 'Closed' : 'Unavailable';
}

/**
 * Returns a formatted time string (e.g. "2:30 PM") indicating when a room's
 * current availability ends, or null if the room isn't currently available.
 * If no more events today, returns "10:00 PM" (closing time).
 */
export function getAvailableUntil(room, currentDateTime = null) {
  const timeZone = 'America/New_York';
  const now = currentDateTime
    ? toZonedTime(currentDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);

  if (isLibCalRoom(room)) {
    const currentBlock = getLibCalCurrentBlock(room, currentDateTime);
    return currentBlock ? formatDecimalHour(currentBlock.time_end) : null;
  }

  if (isSupplementalRoom(room)) {
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const currentBlock = getSupplementalAvailableBlocks(room, now).find(
      (block) => currentHour >= block.start && currentHour < block.end
    );
    return currentBlock ? formatDecimalHour(currentBlock.end) : null;
  }

  // Must be currently available
  const status = getClassroomAvailability(room, currentDateTime, null);
  if (status !== 'Available') return null;

  const currentHour = now.getHours() + now.getMinutes() / 60;
  const dateString = format(now, 'yyyy-MM-dd', { timeZone });

  // Get today's events sorted by start time
  const todayEvents = (room.availability_times || [])
    .filter((t) => t.date.split('T')[0] === dateString && t.status === 1)
    .sort((a, b) => parseFloat(a.time_start) - parseFloat(b.time_start));

  // Find the next event that starts after the current time
  for (const ev of todayEvents) {
    const startDecimal = parseFloat(ev.time_start);
    if (startDecimal > currentHour) {
      return formatDecimalHour(startDecimal);
    }
  }

  // No more events — available until closing
  return formatDecimalHour(OPERATING_END_HOUR);
}

/**
 * Returns the number of decimal hours the room remains available from the
 * current time, or 0 if unavailable.
 */
export function getAvailableForHours(room, currentDateTime = null) {
  const timeZone = 'America/New_York';
  const now = currentDateTime
    ? toZonedTime(currentDateTime, timeZone)
    : toZonedTime(new Date(), timeZone);

  if (isLibCalRoom(room)) {
    const currentBlock = getLibCalCurrentBlock(room, currentDateTime);
    if (!currentBlock) return 0;
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const range = normalizeLibCalRange(currentBlock.time_start, currentBlock.time_end);
    if (!range) return 0;
    const normalizedHour = normalizeLibCalHour(currentHour, range.start);
    return Math.max(0, range.end - normalizedHour);
  }

  if (isSupplementalRoom(room)) {
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const currentBlock = getSupplementalAvailableBlocks(room, now).find(
      (block) => currentHour >= block.start && currentHour < block.end
    );
    if (!currentBlock) return 0;
    return Math.max(0, currentBlock.end - currentHour);
  }

  const status = getClassroomAvailability(room, currentDateTime, null);
  if (status !== 'Available') return 0;

  const currentHour = now.getHours() + now.getMinutes() / 60;
  const dateString = format(now, 'yyyy-MM-dd', { timeZone });

  const todayEvents = (room.availability_times || [])
    .filter((t) => t.date.split('T')[0] === dateString && t.status === 1)
    .sort((a, b) => parseFloat(a.time_start) - parseFloat(b.time_start));

  for (const ev of todayEvents) {
    const startDecimal = parseFloat(ev.time_start);
    if (startDecimal > currentHour) {
      return startDecimal - currentHour;
    }
  }

  return OPERATING_END_HOUR - currentHour;
}

/**
 * Formats a decimal hour (e.g. 14.5) to a time string like "2:30 PM".
 */
function formatDecimalHour(decimal) {
  const hours = Math.floor(decimal);
  const minutes = Math.round((decimal - hours) * 60);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return format(date, 'h:mm a', { timeZone: 'America/New_York' });
}
