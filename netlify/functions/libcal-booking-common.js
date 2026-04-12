if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File extends Blob {
    constructor(parts = [], name = '', options = {}) {
      super(parts, options);
      this.name = String(name);
      this.lastModified = options.lastModified ?? Date.now();
    }
  };
}

const cheerio = require('cheerio');

const LIBCAL_BASE_URL = 'https://umd.libcal.com';
const LIBCAL_ALLSPACES_URL = `${LIBCAL_BASE_URL}/allspaces`;
const LIBCAL_GRID_URL = `${LIBCAL_BASE_URL}/spaces/availability/grid`;
const LIBCAL_BOOKING_ADD_URL = `${LIBCAL_BASE_URL}/spaces/availability/booking/add`;
const LIBCAL_BOOKING_TIMES_URL = `${LIBCAL_BASE_URL}/ajax/space/times`;
const LIBCAL_BOOKING_SUBMIT_URL = `${LIBCAL_BASE_URL}/ajax/space/book`;
const REQUEST_TIMEOUT_MS = 15000;
const BOOKING_METHOD = '17';

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

function formatError(error, fallback) {
  const message = error?.message || fallback;
  return String(message).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toDateKey(dateTimeString) {
  return String(dateTimeString || '').split(' ')[0];
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function createFormBody() {
  return new URLSearchParams();
}

function appendBookingFields(body, booking, prefix = 'bookings[0]') {
  ['id', 'eid', 'seat_id', 'gid', 'lid', 'start', 'end', 'checksum'].forEach((key) => {
    body.append(`${prefix}[${key}]`, String(booking[key] ?? ''));
  });
}

function getBaseHeaders(referer = LIBCAL_ALLSPACES_URL) {
  return {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer,
  };
}

function parseRequestBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (_) {
    throw new Error('Invalid JSON body');
  }
}

function validateRoom(room) {
  if (!room || typeof room !== 'object') {
    throw new Error('Missing room payload');
  }

  const eid = Number(room.eid);
  const gid = Number(room.gid);
  const lid = Number(room.lid);

  if (!Number.isFinite(eid) || !Number.isFinite(gid) || !Number.isFinite(lid)) {
    throw new Error('Room payload must include numeric eid, gid, and lid');
  }

  return {
    eid,
    gid,
    lid,
    name: room.name || '',
    title: room.title || room.name || '',
  };
}

function validateDateTime(dateTimeString, fieldName) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(dateTimeString || ''))) {
    throw new Error(`Expected ${fieldName} in YYYY-MM-DD HH:mm:ss format`);
  }
  return String(dateTimeString);
}

function formatDateTimeLabel(dateTimeString) {
  const [datePart = '', timePart = '00:00:00'] = String(dateTimeString || '').split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

async function fetchGridForWindow(sessionFetch, lid, dateKey) {
  const body = new URLSearchParams({
    lid: String(lid),
    seat: '0',
    seatId: '0',
    zone: '0',
    start: dateKey,
    end: addDays(dateKey, 1),
    bookings: '[]',
    pageIndex: '0',
    pageSize: '5000',
  });

  const response = await sessionFetch(LIBCAL_GRID_URL, {
    method: 'POST',
    headers: getBaseHeaders(),
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`LibCal grid returned HTTP ${response.status}`);
  }

  return response.json();
}

async function createInitialBooking(sessionFetch, room, startDateTime) {
  const sessionPageResponse = await sessionFetch(LIBCAL_ALLSPACES_URL, {
    method: 'GET',
  });
  if (!sessionPageResponse.ok) {
    throw new Error(`LibCal allspaces returned HTTP ${sessionPageResponse.status}`);
  }

  const dateKey = toDateKey(startDateTime);
  const grid = await fetchGridForWindow(sessionFetch, room.lid, dateKey);
  const slots = Array.isArray(grid?.slots) ? grid.slots : [];
  const matchingSlot = slots.find(
    (slot) => Number(slot.itemId) === room.eid && String(slot.start) === startDateTime
  );

  if (!matchingSlot) {
    throw new Error('That study-room start time is no longer available.');
  }

  const body = new URLSearchParams({
    'add[eid]': String(room.eid),
    'add[seat_id]': '0',
    'add[gid]': String(room.gid),
    'add[lid]': String(room.lid),
    'add[start]': matchingSlot.start,
    'add[checksum]': matchingSlot.checksum,
    lid: String(room.lid),
    start: dateKey,
    end: addDays(dateKey, 1),
    bookings: '[]',
  });

  const response = await sessionFetch(LIBCAL_BOOKING_ADD_URL, {
    method: 'POST',
    headers: getBaseHeaders(),
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`LibCal booking/add returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error);
  }

  const booking = Array.isArray(payload?.bookings) ? payload.bookings[0] : null;
  if (!booking) {
    throw new Error('LibCal did not return a pending booking.');
  }

  return booking;
}

async function updateBookingEnd(sessionFetch, booking, targetEnd) {
  if (!targetEnd || String(targetEnd) === String(booking.end)) {
    return booking;
  }

  const optionIndex = (booking.options || []).findIndex((option) => String(option) === String(targetEnd));
  if (optionIndex === -1) {
    throw new Error('Requested LibCal end time is not valid for that room.');
  }

  const body = createFormBody();
  appendBookingFields(body, booking);
  body.append('update[id]', String(booking.id));
  body.append('update[checksum]', String((booking.optionChecksums || [])[optionIndex] || ''));
  body.append('update[end]', String(targetEnd));
  body.append('lid', String(booking.lid));
  body.append('start', toDateKey(booking.start));
  body.append('end', addDays(toDateKey(booking.start), 1));

  const response = await sessionFetch(LIBCAL_BOOKING_ADD_URL, {
    method: 'POST',
    headers: getBaseHeaders(),
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`LibCal booking update returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error);
  }

  const updatedBooking = Array.isArray(payload?.bookings) ? payload.bookings[0] : null;
  if (!updatedBooking) {
    throw new Error('LibCal did not return an updated pending booking.');
  }

  return updatedBooking;
}

async function fetchBookingDetailsHtml(sessionFetch, booking) {
  const body = createFormBody();
  body.append('patron', '');
  body.append('patronHash', '');
  body.append('returnUrl', '');
  body.append('method', BOOKING_METHOD);
  appendBookingFields(body, booking);

  const response = await sessionFetch(LIBCAL_BOOKING_TIMES_URL, {
    method: 'POST',
    headers: getBaseHeaders(),
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`LibCal booking details returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error);
  }

  if (!payload?.html) {
    throw new Error('LibCal did not return booking form HTML.');
  }

  return payload.html;
}

function parseBookingFormHtml(html) {
  const $ = cheerio.load(html);

  const holdMessage = $('.s-lc-session-info').first().text().trim();
  const summaryRows = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => $(cell).text().trim())
      .get();

    if (cells.length >= 4) {
      summaryRows.push({
        item: cells[0] || '',
        category: cells[1] || '',
        from: cells[2] || '',
        to: cells[3] || '',
      });
    }
  });

  const termsHtml = $('#s-lc-eq-terms .s-lc-eq-co-terms').html() || '';
  const submitLabel = $('#btn-form-submit').first().text().trim() || 'Submit Booking';
  const session = $('#s-lc-eq-bform input[name="session"]').attr('value') || '';

  const fields = [];
  $('#s-lc-eq-bform .form-group').each((_, group) => {
    const groupEl = $(group);
    const groupClass = String(groupEl.attr('class') || '');
    const groupId = String(groupEl.attr('id') || '');
    if (
      groupClass.includes('s-inph-ox') ||
      groupId.startsWith('slch_') ||
      groupId.startsWith('slchp-') ||
      groupId.startsWith('slcrh-')
    ) {
      return;
    }
    const controlLabel = groupEl.find('.control-label').first().text().replace(/\*/g, '').trim();
    const helpText = groupEl.find('.help-block').first().text().trim();

    groupEl.find('input, select, textarea').each((__, field) => {
      const fieldEl = $(field);
      const name = fieldEl.attr('name');
      if (!name || name === 'session') return;
      if (/^(URL|Zip|Name|Question|E-mail)$/i.test(name)) return;

      const tagName = field.tagName.toLowerCase();
      const type = tagName === 'select' ? 'select' : fieldEl.attr('type') || tagName;
      if (type === 'hidden') return;

      let label = controlLabel;
      if (!label) {
        const ariaLabel = fieldEl.attr('aria-label');
        const placeholder = fieldEl.attr('placeholder');
        label = ariaLabel || placeholder || name;
      }

      const fieldData = {
        name,
        label,
        type,
        required: fieldEl.is('[required]') || fieldEl.attr('aria-required') === 'true',
        placeholder: fieldEl.attr('placeholder') || '',
        helpText,
      };

      if (tagName === 'select') {
        fieldData.options = fieldEl
          .find('option')
          .map((___, option) => {
            const optionEl = $(option);
            const text = optionEl.text().trim();
            return {
              value: optionEl.attr('value') != null && optionEl.attr('value') !== ''
                ? optionEl.attr('value')
                : text,
              label: text,
              disabled: optionEl.is('[disabled]'),
            };
          })
          .get();
      }

      fields.push(fieldData);
    });
  });

  return {
    holdMessage,
    summaryRows,
    termsHtml,
    submitLabel,
    session,
    fields,
  };
}

function buildDurationOptions(booking) {
  return (booking.options || []).map((end, index) => ({
    end,
    label: formatDateTimeLabel(end),
    selected: booking.optionSelected === index,
  }));
}

function getVisibleFieldNames(parsedForm) {
  return new Set((parsedForm?.fields || []).map((field) => field.name));
}

function createSessionFetch() {
  const cookies = new Map();

  const getSetCookieHeaders = (response) => {
    if (typeof response.headers.getSetCookie === 'function') {
      return response.headers.getSetCookie();
    }

    const single = response.headers.get('set-cookie');
    return single ? [single] : [];
  };

  const rememberCookies = (response) => {
    getSetCookieHeaders(response).forEach((headerValue) => {
      const [pair] = String(headerValue || '').split(';');
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0) return;
      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      if (!name) return;
      cookies.set(name, value);
    });
  };

  const getCookieHeader = () => (
    Array.from(cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  );

  return async (url, options = {}) => {
    const cookieHeader = getCookieHeader();
    const response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });
    rememberCookies(response);
    return response;
  };
}

async function buildBookingFormPayload({ room, startDateTime, endDateTime }) {
  const sessionFetch = await createSessionFetch();
  let booking = await createInitialBooking(sessionFetch, room, startDateTime);
  booking = await updateBookingEnd(sessionFetch, booking, endDateTime);
  const html = await fetchBookingDetailsHtml(sessionFetch, booking);
  const parsed = parseBookingFormHtml(html);

  return {
    booking,
    parsed,
    html,
  };
}

async function submitBooking({ bookingContext, fieldValues }) {
  const session = bookingContext?.session;
  const booking = bookingContext?.booking;
  if (!session || !booking) {
    throw new Error('Missing LibCal booking context.');
  }

  const sessionFetch = createSessionFetch();
  const body = createFormBody();
  body.append('session', String(session));

  Object.entries(fieldValues || {}).forEach(([name, rawValue]) => {
    body.append(name, rawValue == null ? '' : String(rawValue));
  });

  body.append(
    'bookings',
    JSON.stringify([
      {
        id: booking.id,
        eid: booking.eid,
        seat_id: booking.seat_id,
        gid: booking.gid,
        lid: booking.lid,
        start: booking.start,
        end: booking.end,
        checksum: booking.checksum,
      },
    ])
  );
  body.append('method', BOOKING_METHOD);

  const response = await sessionFetch(LIBCAL_BOOKING_SUBMIT_URL, {
    method: 'POST',
    headers: getBaseHeaders(),
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `LibCal booking submit returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error);
  }

  return payload;
}

module.exports = {
  BOOKING_METHOD,
  createInitialBooking,
  createSessionFetch,
  LIBCAL_ALLSPACES_URL,
  badRequest,
  buildBookingFormPayload,
  buildDurationOptions,
  formatDateTimeLabel,
  formatError,
  json,
  parseRequestBody,
  submitBooking,
  toDateKey,
  validateDateTime,
  validateRoom,
};
