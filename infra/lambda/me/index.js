exports.handler = async (event) => {
  const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};

  const sub = claims.sub ?? null;
  const email = claims.email ?? null;
  const username = claims["cognito:username"] ?? null;

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      sub,
      email,
      username,
      issuer: claims.iss ?? null,
      tokenUse: claims.token_use ?? null,
    }),
  };
};

