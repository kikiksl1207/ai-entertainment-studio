// Set private response headers before parsing and authentication on exact rewards routes.
export function rewardsPrivacyMiddleware(
  request: { method?: string; path: string },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
) {
  let pathname: string;
  try { pathname = request.path; }
  catch { next(); return; }
  const read = ['GET', 'HEAD'].includes(request.method ?? '') &&
    /^\/api\/v1\/rewards\/(?:referral-code|referrals|daily-attendance(?:\/policy)?|activation-policy|ledger-policy|activation-progress|birthday)\/?$/i.test(pathname);
  const write = request.method === 'POST' &&
    /^\/api\/v1\/rewards\/(?:daily-attendance|birthday\/claim|activation-quests\/[^/]+\/claim)\/?$/i.test(pathname);
  if (read || write) response.setHeader('Cache-Control', 'private, no-store');
  next();
}
