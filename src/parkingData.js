import { toZonedTime } from 'date-fns-tz';

const PARKING_TIME_ZONE = 'America/New_York';
const PARKING_DISPLAY_OFFSETS = {
  'Lot U2': { lat: -0.00008, lng: -0.00018 },
  'Mowatt Lane Garage': { lat: 0.00008, lng: 0.00018 },
};

export const PARKING_RULES = {
  global_rules: {
    timezone: PARKING_TIME_ZONE,
    weekend_unrestricted: true,
    weekend_start: { day: 5, time: '16:00' },
    weekend_end: { day: 1, time: '07:00' },
  },
  free_lots: {
    'Lot 1': {
      lat: 38.986145,
      lng: -76.950234,
      description: 'West of Cole Field House / Ludwig Field (Lot 1 area)',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Lot Z': {
      lat: 38.988132,
      lng: -76.94932,
      description: 'West campus between Cole Field House and Jones-Hill House',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Lot U1': {
      lat: 38.982518,
      lng: -76.943732,
      description: 'South campus near South Campus Commons / Mowatt Lane',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Lot U2': {
      lat: 38.981821,
      lng: -76.945551,
      description: 'Mowatt Lane Garage U2 area',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Terrapin Trail Garage': {
      lat: 38.994998,
      lng: -76.943362,
      description: 'North campus near Xfinity Center. Warning: Often restricted during basketball/sports games.',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Regents Drive Garage (Unrestricted Levels)': {
      lat: 38.989729,
      lng: -76.94146,
      description: 'Central campus, unrestricted levels only (check signs)',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Lot 9': {
      lat: 38.994263,
      lng: -76.939216,
      description: 'North campus near the engineering buildings',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Lot 11': {
      lat: 38.993773,
      lng: -76.936247,
      description: 'North campus near the View/Varsity',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
    'Lot 16': {
      lat: 38.983962,
      lng: -76.934927,
      description: 'East campus near Fraternity Row (Lot 16 area)',
      free_hours: { weekdays: { start: '16:00', end: '07:00' }, weekends: 'All Day' },
    },
  },
  paid_visitor_garages: {
    'Mowatt Lane Garage': {
      lat: 38.981826,
      lng: -76.945571,
      description: 'South campus near Van Munching Hall',
      status: 'Paid 24/7 or requires specific permit',
    },
    'Union Lane Garage': {
      lat: 38.98841,
      lng: -76.945847,
      description: 'Central campus next to Stamp Student Union',
      status: 'Paid 24/7 or requires specific permit',
    },
    'Regents Drive Garage (Visitor Section)': {
      lat: 38.989729,
      lng: -76.94146,
      description: 'Central campus, ground levels',
      status: 'Paid 24/7 or requires specific permit',
    },
  },
};

function parseTimeToMinutes(timeString) {
  const [hours, minutes] = String(timeString).split(':').map(Number);
  return hours * 60 + minutes;
}

function formatParkingTime(timeString) {
  const [hours, minutes] = String(timeString).split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const normalizedHour = hours % 12 || 12;
  if (minutes === 0) return `${normalizedHour} ${suffix}`;
  return `${normalizedHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function isWithinWeekendWindow(date) {
  if (!PARKING_RULES.global_rules.weekend_unrestricted) return false;

  const day = date.getDay();
  const minutes = date.getHours() * 60 + date.getMinutes();
  const weekendStartMinutes = parseTimeToMinutes(PARKING_RULES.global_rules.weekend_start.time);
  const weekendEndMinutes = parseTimeToMinutes(PARKING_RULES.global_rules.weekend_end.time);

  if (day === PARKING_RULES.global_rules.weekend_start.day && minutes >= weekendStartMinutes) {
    return true;
  }

  if (day === 6 || day === 0) {
    return true;
  }

  if (day === PARKING_RULES.global_rules.weekend_end.day && minutes < weekendEndMinutes) {
    return true;
  }

  return false;
}

function isWithinOvernightRange(minutes, startMinutes, endMinutes) {
  if (startMinutes <= endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  return minutes >= startMinutes || minutes < endMinutes;
}

export function getParkingReferenceDate(viewMode, selectedStartDateTime) {
  return viewMode === 'now' ? new Date() : selectedStartDateTime;
}

export function getParkingStatus(lot, referenceDate = new Date()) {
  const zonedDate = toZonedTime(referenceDate, PARKING_TIME_ZONE);

  if (lot.kind === 'paid') {
    return 'Visitor';
  }

  if (isWithinWeekendWindow(zonedDate)) {
    return 'Free';
  }

  const minutes = zonedDate.getHours() * 60 + zonedDate.getMinutes();
  const weekdays = lot.free_hours?.weekdays;
  if (!weekdays) return 'Restricted';

  const startMinutes = parseTimeToMinutes(weekdays.start);
  const endMinutes = parseTimeToMinutes(weekdays.end);
  return isWithinOvernightRange(minutes, startMinutes, endMinutes) ? 'Free' : 'Restricted';
}

export function getParkingStatusLabel(status) {
  if (status === 'Free') return 'free now';
  if (status === 'Visitor') return 'visitor paid';
  return 'permit required';
}

function getParkingRuleSummary(lot, kind) {
  if (kind === 'paid') {
    return lot.status;
  }

  const weekdays = lot.free_hours?.weekdays;
  if (!weekdays) return 'Check posted parking signage';

  return `Free weekdays ${formatParkingTime(weekdays.start)}-${formatParkingTime(weekdays.end)}; weekends all day`;
}

export function getParkingFeatures(referenceDate = new Date()) {
  const freeLots = Object.entries(PARKING_RULES.free_lots).map(([name, lot]) => {
    const offset = PARKING_DISPLAY_OFFSETS[name] || { lat: 0, lng: 0 };
    return ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lot.lng + offset.lng, lot.lat + offset.lat],
    },
    properties: {
      name,
      description: lot.description,
      status: getParkingStatus({ ...lot, kind: 'free' }, referenceDate),
      kind: 'free',
      detail: getParkingRuleSummary(lot, 'free'),
      trueLongitude: lot.lng,
      trueLatitude: lot.lat,
    },
  })});

  const visitorGarages = Object.entries(PARKING_RULES.paid_visitor_garages).map(([name, lot]) => {
    const offset = PARKING_DISPLAY_OFFSETS[name] || { lat: 0, lng: 0 };
    return ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lot.lng + offset.lng, lot.lat + offset.lat],
    },
    properties: {
      name,
      description: lot.description,
      status: getParkingStatus({ ...lot, kind: 'paid' }, referenceDate),
      kind: 'paid',
      detail: getParkingRuleSummary(lot, 'paid'),
      trueLongitude: lot.lng,
      trueLatitude: lot.lat,
    },
  })});

  return [...freeLots, ...visitorGarages];
}
