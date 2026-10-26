export type AvailabilityMode = 'open' | 'maintenance' | 'developer_hold';
export type AvailabilityState = Readonly<{
  mode: AvailabilityMode;
  revision: number;
  changedAt: string;
  changedBy: string;
  /** Private operational note. Never included in public responses. */
  reason: string;
  /** Estimate only; never automatically reopens the service. */
  expectedBackAt?: string;
}>;
export type AvailabilityChange = Readonly<{
  mode: AvailabilityMode;
  actor: string;
  reason: string;
  expectedBackAt?: string;
}>;
export type PublicAvailability = Readonly<{
  serviceName: string;
  contactUrl?: string;
  contactLabel?: string;
}>;
const modes = new Set(['open', 'maintenance', 'developer_hold']);
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** Validate persisted input before it reaches a routing decision. Invalid state throws. */
export function parseAvailabilityState(value: unknown): AvailabilityState {
  if (!value || typeof value !== 'object') throw new Error('Invalid availability state');
  const v = value as Record<string, unknown>;
  if (typeof v.mode !== 'string' || !modes.has(v.mode) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || !validDate(v.changedAt) || !nonempty(v.changedBy) || !nonempty(v.reason)) throw new Error('Invalid availability state');
  if (v.expectedBackAt !== undefined && (!validDate(v.expectedBackAt) || v.mode !== 'maintenance')) throw new Error('Only maintenance accepts an expected return time');
  return Object.freeze({mode:v.mode as AvailabilityMode, revision:Number(v.revision), changedAt:v.changedAt, changedBy:v.changedBy, reason:v.reason, ...(v.expectedBackAt === undefined ? {} : {expectedBackAt:v.expectedBackAt as string})});
}
/** Host must serialize/persist returned state with a revision compare-and-swap. */
export async function transitionAvailability(input: {
  current: AvailabilityState;
  change: AvailabilityChange;
  expectedRevision: number;
  authorize: (change: AvailabilityChange) => boolean | Promise<boolean>;
  audit: (event: Readonly<{before: AvailabilityState; after: AvailabilityState}>) => void | Promise<void>;
  now?: Date;
}): Promise<AvailabilityState> {
  const current = parseAvailabilityState(input.current);
  if (current.revision !== input.expectedRevision) throw new Error('Availability revision conflict');
  const change = Object.freeze({...input.change});
  const after = parseAvailabilityState({mode:change.mode, revision:current.revision+1, changedAt:(input.now ?? new Date()).toISOString(), changedBy:change.actor, reason:change.reason, ...(change.expectedBackAt === undefined ? {} : {expectedBackAt:change.expectedBackAt})});
  if (!await input.authorize(change)) throw new Error('Availability change not authorized');
  await input.audit(Object.freeze({before:current,after}));
  return after;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function safeContact(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  if (/[\u0000-\u0020\u007f]/u.test(url)) throw new Error('Invalid contact URL');
  const parsed = new URL(url);
  if (!['https:','mailto:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Contact must use HTTPS or mailto');
  return url;
}
function publicDetails(state: AvailabilityState, config: PublicAvailability) {
  if (!nonempty(config.serviceName)) throw new Error('Service name required');
  const hold = state.mode === 'developer_hold';
  return {
    code: hold ? 'SERVICE_ON_HOLD' : 'SERVICE_MAINTENANCE',
    title: hold ? 'Please contact the developer' : 'We’ll be back shortly',
    message: hold ? `${config.serviceName} is temporarily paused. Please contact the developer for help restoring access.` : `${config.serviceName} is undergoing maintenance. Please try again shortly.`,
    ...(state.expectedBackAt ? {expectedBackAt:state.expectedBackAt} : {}),
    ...(config.contactUrl ? {contactUrl:safeContact(config.contactUrl),contactLabel:config.contactLabel ?? 'Contact the developer'} : {}),
  };
}
/** Self-contained HTML suitable for an edge/proxy outage page, with no app dependency. */
export function renderAvailabilityPage(input: AvailabilityState, config: PublicAvailability): string {
  const state = parseAvailabilityState(input);
  if (state.mode === 'open') throw new Error('Open services do not have an outage page');
  const details = publicDetails(state,config);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(config.serviceName)} · ${escapeHtml(details.title)}</title><style>:root{color-scheme:light dark;font-family:system-ui,-apple-system,sans-serif;background:#f4f5f7;color:#192333}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:580px;padding:clamp(28px,6vw,56px);background:#fff;border:1px solid #dce1e8;border-radius:24px;box-shadow:0 18px 70px #12223a0d}.brand{font-weight:650;font-size:15px;letter-spacing:.02em}.mark{width:48px;height:5px;background:#b69a35;border-radius:4px;margin:36px 0 24px}h1{font-size:clamp(28px,5vw,38px);line-height:1.15;letter-spacing:-.035em;margin:0 0 20px}p{font-size:17px;line-height:1.65;color:#526073;margin:0 0 20px}.estimate{font-size:14px}a{display:inline-block;background:#1b2a40;color:#fff;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:8px}a:focus-visible{outline:3px solid #b69a35;outline-offset:4px}@media(prefers-color-scheme:dark){:root{background:#0b111c;color:#eef2f8}main{background:#152031;border-color:#2c3b50}p{color:#b9c5d6}a{background:#dbc465;color:#18202d}}</style></head><body><main><div class="brand">${escapeHtml(config.serviceName)}</div><div class="mark" aria-hidden="true"></div><h1>${escapeHtml(details.title)}</h1><p>${escapeHtml(details.message)}</p>${details.expectedBackAt ? `<p class="estimate">Expected back: <time datetime="${escapeHtml(details.expectedBackAt)}">${escapeHtml(new Date(details.expectedBackAt).toUTCString())}</time></p>` : ''}${details.contactUrl ? `<a href="${escapeHtml(details.contactUrl)}">${escapeHtml(details.contactLabel ?? 'Contact the developer')}</a>` : ''}</main></body></html>`;
}
/** No public bypass, activation endpoint, billing trigger, or timer-based reopening. */
export function availabilityResponse(request: Request, input: AvailabilityState, config: PublicAvailability, now = Date.now()): Response | undefined {
  const state = parseAvailabilityState(input);
  if (state.mode === 'open') return undefined;
  const html = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
  const headers: Record<string,string> = {'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Content-Type':html ? 'text/html; charset=utf-8' : 'application/problem+json; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
  if (state.mode === 'maintenance') headers['Retry-After'] = String(Math.min(86400,Math.max(1,state.expectedBackAt ? Math.ceil((Date.parse(state.expectedBackAt)-now)/1000) : 60)));
  const body = html ? renderAvailabilityPage(state,config) : JSON.stringify({type:'about:blank',status:503,...publicDetails(state,config)});
  return new Response(request.method === 'HEAD' ? null : body,{status:503,headers});
}
