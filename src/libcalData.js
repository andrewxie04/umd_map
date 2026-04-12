const LIBCAL_AVAILABILITY_ENDPOINT = '/.netlify/functions/libcal-availability';
const LIBCAL_BOOKING_OPTIONS_ENDPOINT = '/.netlify/functions/libcal-booking-options';
const LIBCAL_BOOKING_FORM_ENDPOINT = '/.netlify/functions/libcal-booking-form';
const LIBCAL_BOOKING_SUBMIT_ENDPOINT = '/.netlify/functions/libcal-booking-submit';

async function postJson(url, body, { signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage = payload?.details || payload?.error || text || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

export async function fetchLibCalAvailabilityForDate(dateKey, { signal } = {}) {
  const payload = await postJson(LIBCAL_AVAILABILITY_ENDPOINT, { date: dateKey }, { signal });
  return Array.isArray(payload?.buildings) ? payload.buildings : [];
}

export async function fetchLibCalBookingOptions(room, startDateTime, { signal } = {}) {
  return postJson(
    LIBCAL_BOOKING_OPTIONS_ENDPOINT,
    {
      room,
      startDateTime,
    },
    { signal }
  );
}

export async function fetchLibCalBookingForm(room, startDateTime, endDateTime, { signal } = {}) {
  return postJson(
    LIBCAL_BOOKING_FORM_ENDPOINT,
    {
      room,
      startDateTime,
      endDateTime,
    },
    { signal }
  );
}

export async function submitLibCalBooking(bookingContext, fieldValues, { signal } = {}) {
  return postJson(
    LIBCAL_BOOKING_SUBMIT_ENDPOINT,
    {
      bookingContext,
      fieldValues,
    },
    { signal }
  );
}
