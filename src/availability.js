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

/**
 * Debug function to log availability calculation steps
 */
export function debugClassroomAvailability(room, selectedStartDateTime, selectedEndDateTime) {
  const debug = getClassroomAvailability(room, selectedStartDateTime, selectedEndDateTime, true);
  console.log('Availability Debug:', debug);
  return debug.status;
}

/**
 * Checks if a given date is a university holiday.
 */
function isUniversityHoliday(date) {
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
  const currentEndTime = selectedEndDateTime
    ? toZonedTime(selectedEndDateTime, timeZone)
    : currentStartTime; // For "now" view, start and end time are the same

  if (debug) {
    debugInfo.steps.push({
      step: 'Times',
      requested: {
        start: currentStartTime.toISOString(),
        end: currentEndTime.toISOString()
      }
    });
  }

  // Check weekend
  const dateToCheck = new Date(currentStartTime);
  const dayOfWeek = dateToCheck.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return debug ? { status: 'Closed', reason: 'Weekend' } : 'Closed';
  }

  // Check holidays
  if (isUniversityHoliday(dateToCheck)) {
    return debug ? { status: 'Closed', reason: 'Holiday' } : 'Closed';
  }

  // Check operating hours
  const currentHour = currentStartTime.getHours() + currentStartTime.getMinutes() / 60;

  if (currentHour < OPERATING_START_HOUR || currentHour >= OPERATING_END_HOUR) {
    return debug ? { status: 'Closed', reason: 'Outside Operating Hours' } : 'Closed';
  }

  // Check if availability data exists
  if (!room.availability_times || !Array.isArray(room.availability_times)) {
    return debug ? { status: 'Available', reason: 'No Schedule Data' } : 'Available';
  }

  // Get events for the date and with status:1
  const dateString = format(dateToCheck, 'yyyy-MM-dd', { timeZone });
  const todayAvailability = room.availability_times.filter((timeRange) => {
    const eventDatePart = timeRange.date.split('T')[0];
    return eventDatePart === dateString && timeRange.status === 1;
  });

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

  return overlappingEvents.length === 0 ? 'Available' : 'Unavailable';
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
  for (const room of classrooms) {
    const status = getClassroomAvailability(room, selectedStartDateTime, selectedEndDateTime);
    if (status === 'Available') return 'Available';
    if (status !== 'Closed') allClosed = false;
  }

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
