const {
  badRequest,
  formatError,
  json,
  parseRequestBody,
  submitBooking,
  validateDateTime,
  validateRoom,
} = require('./libcal-booking-common');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = parseRequestBody(event);
  } catch (error) {
    return badRequest(error.message);
  }

  try {
    if (!payload.bookingContext?.booking || !payload.bookingContext?.session) {
      return badRequest('Missing bookingContext from the booking form step');
    }

    validateRoom({
      eid: payload.bookingContext.booking.eid,
      gid: payload.bookingContext.booking.gid,
      lid: payload.bookingContext.booking.lid,
    });
    validateDateTime(payload.bookingContext.booking.start, 'bookingContext.booking.start');
    validateDateTime(payload.bookingContext.booking.end, 'bookingContext.booking.end');
    const fieldValues = payload.fieldValues || {};

    const result = await submitBooking({
      bookingContext: payload.bookingContext,
      fieldValues,
    });

    return json(200, {
      bookId: result.bookId || null,
      successHtml: result.html || '',
    });
  } catch (error) {
    return json(502, {
      error: 'Failed to submit the LibCal booking',
      details: formatError(error, 'Unknown LibCal submit error'),
    });
  }
};
