import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const DINING_ENDPOINT = '/.netlify/functions/dining-status';
const TIME_ZONE = 'America/New_York';
const OPENING_SOON_MINUTES = 90;

const HALL_HOURS = {
  'south-campus': {
    0: [10 * 60, 21 * 60],
    1: [7 * 60, 21 * 60],
    2: [7 * 60, 21 * 60],
    3: [7 * 60, 21 * 60],
    4: [7 * 60, 21 * 60],
    5: [7 * 60, 21 * 60],
    6: [10 * 60, 21 * 60],
  },
  yahentamitsi: {
    0: [10 * 60, 21 * 60],
    1: [7 * 60, 21 * 60],
    2: [7 * 60, 21 * 60],
    3: [7 * 60, 21 * 60],
    4: [7 * 60, 21 * 60],
    5: [7 * 60, 21 * 60],
    6: [10 * 60, 21 * 60],
  },
  '251-north': {
    0: [8 * 60, 19 * 60],
    1: [8 * 60, 22 * 60],
    2: [8 * 60, 22 * 60],
    3: [8 * 60, 22 * 60],
    4: [8 * 60, 22 * 60],
    5: [8 * 60, 19 * 60],
    6: [8 * 60, 19 * 60],
  },
};

const HALL_MEAL_WINDOWS = {
  'south-campus': {
    weekday: {
      Breakfast: [7 * 60, 10 * 60 + 30],
      Lunch: [10 * 60 + 30, 16 * 60],
      Dinner: [16 * 60, 21 * 60],
    },
    weekend: {
      Brunch: [10 * 60, 16 * 60],
      Dinner: [16 * 60, 21 * 60],
    },
  },
  yahentamitsi: {
    weekday: {
      Breakfast: [7 * 60, 10 * 60 + 30],
      Lunch: [10 * 60 + 30, 16 * 60],
      Dinner: [16 * 60, 21 * 60],
    },
    weekend: {
      Brunch: [10 * 60, 16 * 60],
      Dinner: [16 * 60, 21 * 60],
    },
  },
  '251-north': {
    weekday: {
      Breakfast: [8 * 60, 10 * 60 + 30],
      Lunch: [10 * 60 + 30, 16 * 60],
      Dinner: [16 * 60, 22 * 60],
    },
    friday: {
      Breakfast: [8 * 60, 10 * 60 + 30],
      Lunch: [10 * 60 + 30, 16 * 60],
      Dinner: [16 * 60, 19 * 60],
    },
    weekend: {
      Breakfast: [8 * 60, 10 * 60 + 30],
      Lunch: [10 * 60 + 30, 16 * 60],
      Dinner: [16 * 60, 19 * 60],
    },
  },
};

async function postJson(url, body, { signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.details || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function toReferenceDate(referenceDateTime = new Date()) {
  return toZonedTime(referenceDateTime, TIME_ZONE);
}

function getMinutesIntoDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutes(minutes) {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return format(date, 'h:mm a');
}

function getMealWindowMapForHall(hall, date) {
  const config = HALL_MEAL_WINDOWS[hall?.id];
  if (!config) return {};
  const day = date.getDay();
  if (day === 5 && config.friday) return config.friday;
  if (day === 0 || day === 6) return config.weekend || {};
  return config.weekday || {};
}

function getHallOpenWindow(hall, referenceDateTime) {
  const referenceDate = toReferenceDate(referenceDateTime);
  const hoursByDay = HALL_HOURS[hall?.id];
  const window = hoursByDay?.[referenceDate.getDay()];
  if (!window) return null;
  const [startMinutes, endMinutes] = window;
  return {
    startMinutes,
    endMinutes,
    startLabel: formatMinutes(startMinutes),
    endLabel: formatMinutes(endMinutes),
  };
}

function getMealWindows(hall, referenceDateTime) {
  const referenceDate = toReferenceDate(referenceDateTime);
  const windowMap = getMealWindowMapForHall(hall, referenceDate);

  return (hall?.meals || [])
    .map((meal) => {
      const window = windowMap[meal.name];
      if (!window) return null;
      const [startMinutes, endMinutes] = window;
      return {
        ...meal,
        startMinutes,
        endMinutes,
        startLabel: formatMinutes(startMinutes),
        endLabel: formatMinutes(endMinutes),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

function normalizeRetailHoursLabel(label) {
  return String(label || '').replace(/\u2026/g, '...').trim();
}

function parseTimeLabelToMinutes(label) {
  const match = String(label || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i);
  if (!match) return null;
  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2] || 0);
  const meridiem = match[3].toLowerCase();
  if (meridiem === 'p') hours += 12;
  return hours * 60 + minutes;
}

function parseRetailHoursRange(hoursLabel) {
  const normalized = normalizeRetailHoursLabel(hoursLabel);
  if (!normalized || /^(closed|tbd|n\/?a)$/i.test(normalized)) return null;

  const match = normalized.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  if (!match) return null;

  const startMinutes = parseTimeLabelToMinutes(match[1].replace(/\s+/g, ''));
  const endMinutes = parseTimeLabelToMinutes(match[2].replace(/\s+/g, ''));
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return null;

  return {
    startMinutes,
    endMinutes: endMinutes <= startMinutes ? endMinutes + 24 * 60 : endMinutes,
    startLabel: formatMinutes(startMinutes),
    endLabel: formatMinutes(endMinutes),
    label: normalized,
  };
}

function getRetailSubvenueWindows(venue) {
  return (venue?.subvenues || [])
    .map((subvenue) => {
      const range = parseRetailHoursRange(subvenue.hoursLabel);
      return {
        ...subvenue,
        ...range,
      };
    })
    .filter((subvenue) => Number.isFinite(subvenue.startMinutes))
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export function isRetailDiningVenue(venue) {
  return venue?.kind === 'retail';
}

export function getRetailSubvenueStatusInfo(venue, subvenue, referenceDateTime = new Date()) {
  const referenceDate = toReferenceDate(referenceDateTime);
  const minuteOfDay = getMinutesIntoDay(referenceDate);
  const window = parseRetailHoursRange(subvenue?.hoursLabel);

  if (!window) {
    return {
      status: 'Unavailable',
      badgeLabel: /tbd/i.test(String(subvenue?.hoursLabel || '')) ? 'Hours TBD' : 'Closed',
      summary: normalizeRetailHoursLabel(subvenue?.hoursLabel) || 'Closed',
    };
  }

  const normalizedMinute = minuteOfDay < window.startMinutes ? minuteOfDay + 24 * 60 : minuteOfDay;
  if (normalizedMinute >= window.startMinutes && normalizedMinute < window.endMinutes) {
    return {
      status: 'Available',
      badgeLabel: 'Open Now',
      summary: `Open until ${window.endLabel}.`,
    };
  }

  if (minuteOfDay < window.startMinutes) {
    const opensInMinutes = window.startMinutes - minuteOfDay;
    return {
      status: 'Opening Soon',
      badgeLabel: opensInMinutes <= OPENING_SOON_MINUTES ? 'Opens Soon' : 'Opens Later',
      summary: `Opens at ${window.startLabel}.`,
    };
  }

  return {
    status: 'Unavailable',
    badgeLabel: 'Closed',
    summary: `Closed. Hours were ${window.startLabel}–${window.endLabel}.`,
  };
}

export function getDiningStatusInfo(hall, referenceDateTime = new Date()) {
  const referenceDate = toReferenceDate(referenceDateTime);
  const minuteOfDay = getMinutesIntoDay(referenceDate);

  if (isRetailDiningVenue(hall)) {
    const subvenues = getRetailSubvenueWindows(hall);
    if (!subvenues.length) {
      return {
        status: 'Unavailable',
        badgeLabel: 'Closed',
        summary: 'No posted hours for this date yet.',
        currentMeal: null,
        nextMeal: null,
        recommendedMealName: '',
      };
    }

    const currentlyOpen = subvenues.filter((subvenue) => {
      const normalizedMinute = minuteOfDay < subvenue.startMinutes ? minuteOfDay + 24 * 60 : minuteOfDay;
      return normalizedMinute >= subvenue.startMinutes && normalizedMinute < subvenue.endMinutes;
    });

    if (currentlyOpen.length) {
      const soonestClose = currentlyOpen.slice().sort((a, b) => a.endMinutes - b.endMinutes)[0];
      return {
        status: 'Available',
        badgeLabel: 'Open Now',
        summary: currentlyOpen.length === 1
          ? `${currentlyOpen[0].name} is open until ${soonestClose.endLabel}.`
          : `${currentlyOpen.length} spots are open now. Earliest close is ${soonestClose.endLabel}.`,
        currentMeal: null,
        nextMeal: null,
        recommendedMealName: '',
      };
    }

    const nextOpen = subvenues.find((subvenue) => subvenue.startMinutes > minuteOfDay) || null;
    if (nextOpen) {
      const opensInMinutes = nextOpen.startMinutes - minuteOfDay;
      return {
        status: 'Opening Soon',
        badgeLabel: opensInMinutes <= OPENING_SOON_MINUTES ? 'Opens Soon' : 'Opens Later',
        summary: `${nextOpen.name} opens at ${nextOpen.startLabel}.`,
        currentMeal: null,
        nextMeal: null,
        recommendedMealName: '',
      };
    }

    return {
      status: 'Unavailable',
      badgeLabel: 'Closed',
      summary: 'Closed for the day.',
      currentMeal: null,
      nextMeal: null,
      recommendedMealName: '',
    };
  }

  const mealWindows = getMealWindows(hall, referenceDate);
  const fallbackMeal = (hall?.meals || [])[0] || null;
  const openWindow = getHallOpenWindow(hall, referenceDate);

  if (!mealWindows.length) {
    return {
      status: 'Unavailable',
      badgeLabel: 'Closed',
      summary: 'No menu is posted for this date yet.',
      currentMeal: null,
      nextMeal: null,
      recommendedMealName: fallbackMeal?.name || '',
    };
  }

  const currentMeal = mealWindows.find(
    (meal) => minuteOfDay >= meal.startMinutes && minuteOfDay < meal.endMinutes
  );
  const nextMeal = mealWindows.find((meal) => meal.startMinutes > minuteOfDay) || null;
  const isOpenNow = openWindow
    ? minuteOfDay >= openWindow.startMinutes && minuteOfDay < openWindow.endMinutes
    : Boolean(currentMeal);

  if (isOpenNow) {
    return {
      status: 'Available',
      badgeLabel: 'Open Now',
      summary: currentMeal
        ? `${currentMeal.name} is serving until ${currentMeal.endLabel}.`
        : `Open until ${openWindow?.endLabel || 'closing'}.`,
      currentMeal,
      nextMeal,
      recommendedMealName: currentMeal?.name || nextMeal?.name || fallbackMeal?.name || '',
    };
  }

  if (openWindow && minuteOfDay < openWindow.startMinutes) {
    const opensInMinutes = openWindow.startMinutes - minuteOfDay;
    return {
      status: 'Opening Soon',
      badgeLabel: opensInMinutes <= OPENING_SOON_MINUTES ? 'Opens Soon' : 'Opens Later',
      summary: nextMeal
        ? `Next up: ${nextMeal.name} at ${nextMeal.startLabel}.`
        : `Opens at ${openWindow.startLabel}.`,
      currentMeal: null,
      nextMeal,
      recommendedMealName: nextMeal?.name || fallbackMeal?.name || '',
    };
  }

  return {
    status: 'Unavailable',
    badgeLabel: 'Closed',
    summary: openWindow
      ? `Closed for the day. Hours were ${openWindow.startLabel}–${openWindow.endLabel}.`
      : 'No more meals are scheduled for this date.',
    currentMeal: null,
    nextMeal: null,
    recommendedMealName: fallbackMeal?.name || '',
  };
}

export function getDiningStatusClassName(status) {
  switch (status) {
    case 'Available':
      return 'available';
    case 'Opening Soon':
      return 'opening-soon';
    default:
      return 'unavailable';
  }
}

export function getDiningStatusMarkerColor(status) {
  switch (status) {
    case 'Available':
      return '#34C759';
    case 'Opening Soon':
      return '#FFCC00';
    default:
      return '#FF3B30';
  }
}

export function getRecommendedDiningMealName(hall, referenceDateTime = new Date()) {
  const statusInfo = getDiningStatusInfo(hall, referenceDateTime);
  return (
    statusInfo.recommendedMealName ||
    (hall?.meals && hall.meals[0] ? hall.meals[0].name : '')
  );
}

export function getDiningHoursLabel(hall, referenceDateTime = new Date()) {
  if (isRetailDiningVenue(hall)) {
    return '';
  }
  const window = getHallOpenWindow(hall, referenceDateTime);
  if (!window) return '';
  return `${window.startLabel}–${window.endLabel}`;
}

export async function fetchDiningHallsForDate(dateKey, { signal } = {}) {
  const payload = await postJson(DINING_ENDPOINT, { date: dateKey }, { signal });
  const halls = Array.isArray(payload?.halls) ? payload.halls : [];
  const retailVenues = Array.isArray(payload?.retailVenues) ? payload.retailVenues : [];
  return [...halls, ...retailVenues];
}
