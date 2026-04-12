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

const WEEKDAY_WINDOWS = {
  Breakfast: [7 * 60, 10 * 60 + 30],
  Lunch: [11 * 60, 14 * 60 + 30],
  Dinner: [17 * 60, 21 * 60],
};

const WEEKEND_WINDOWS = {
  Brunch: [10 * 60, 14 * 60 + 30],
  Dinner: [17 * 60, 21 * 60],
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

function getWindowMapForDate(date) {
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  return isWeekend ? WEEKEND_WINDOWS : WEEKDAY_WINDOWS;
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
  const windowMap = getWindowMapForDate(referenceDate);

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

export function getDiningStatusInfo(hall, referenceDateTime = new Date()) {
  const referenceDate = toReferenceDate(referenceDateTime);
  const minuteOfDay = getMinutesIntoDay(referenceDate);
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
        ? `${nextMeal.name} starts at ${nextMeal.startLabel}.`
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
  const window = getHallOpenWindow(hall, referenceDateTime);
  if (!window) return '';
  return `${window.startLabel}–${window.endLabel}`;
}

export async function fetchDiningHallsForDate(dateKey, { signal } = {}) {
  const payload = await postJson(DINING_ENDPOINT, { date: dateKey }, { signal });
  return Array.isArray(payload?.halls) ? payload.halls : [];
}
