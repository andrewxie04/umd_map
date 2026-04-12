const {
  badRequest,
  buildBookingFormPayload,
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
    const endDateTime = validateDateTime(payload.endDateTime, 'endDateTime');
    const { booking, parsed } = await buildBookingFormPayload({ room, startDateTime, endDateTime });

    return json(200, {
      bookingContext: {
        session: parsed.session,
        booking: {
          id: booking.id,
          eid: booking.eid,
          seat_id: booking.seat_id,
          gid: booking.gid,
          lid: booking.lid,
          start: booking.start,
          end: booking.end,
          checksum: booking.checksum,
        },
      },
      booking: {
        startDateTime: booking.start,
        endDateTime: booking.end,
      },
      holdMessage: parsed.holdMessage,
      summaryRows: parsed.summaryRows,
      termsHtml: parsed.termsHtml,
      fields: parsed.fields,
      submitLabel: parsed.submitLabel,
    });
  } catch (error) {
    return json(502, {
      error: 'Failed to load the LibCal booking form',
      details: formatError(error, 'Unknown LibCal booking form error'),
    });
  }
};
