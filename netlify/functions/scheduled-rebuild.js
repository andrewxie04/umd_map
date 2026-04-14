exports.handler = async () => {
  const hookUrl = process.env.BUILD_HOOK_URL;
  if (!hookUrl) {
    return { statusCode: 500, body: 'BUILD_HOOK_URL not configured' };
  }

  const response = await fetch(hookUrl, { method: 'POST' });
  if (!response.ok) {
    return { statusCode: 502, body: `Build hook returned ${response.status}` };
  }

  return { statusCode: 200, body: 'Rebuild triggered' };
};
