const {
  badRequest,
  createInitialBooking,
  createSessionFetch,
  buildDurationOptions,
  formatDateTimeLabel,
  formatError,
  json,
  parseRequestBody,
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
    const room = validateRoom(payload.room);
    const startDateTime = validateDateTime(payload.startDateTime, 'startDateTime');
    const sessionFetch = createSessionFetch();
    const booking = await createInitialBooking(sessionFetch, room, startDateTime);

    return json(200, {
      startDateTime: booking.start,
      defaultEndDateTime: booking.end,
      startLabel: formatDateTimeLabel(booking.start),
      endLabel: formatDateTimeLabel(booking.end),
      durationOptions: buildDurationOptions(booking),
    });
  } catch (error) {
    return json(502, {
      error: 'Failed to start the LibCal booking flow',
      details: formatError(error, 'Unknown LibCal booking error'),
    });
  }
};
