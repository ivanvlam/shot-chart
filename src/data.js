export const DATA_VERSION = String(Date.now());

const rosterUrl = new URL('../data/roster.js', import.meta.url);
rosterUrl.searchParams.set('v', DATA_VERSION);
export const { ROSTER } = await import(rosterUrl.href);

export const shotCache = new Map();
