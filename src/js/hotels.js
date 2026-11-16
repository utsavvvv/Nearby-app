// Links to hotel booking sites. Clicking one opens the partner's site, where the traveller
// sees live prices and books; with an affiliate ID configured, bookings earn a commission.
import { BOOKING_AFFILIATE_ID } from './config.js';

const param = (k, v) => (v ? `&${k}=${encodeURIComponent(v)}` : '');

/** Search Booking.com for a specific hotel (by name and area). */
export function hotelUrl(place, areaName = '', affiliateId = BOOKING_AFFILIATE_ID) {
  const query = [place.name, place.address || areaName].filter(Boolean).join(', ') || areaName;
  return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(query)}${param('aid', affiliateId)}${param('label', 'nearby-offline-place')}`;
}

/** Search Booking.com for all stays in an area. */
export function areaHotelsUrl(areaName, affiliateId = BOOKING_AFFILIATE_ID) {
  return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(areaName)}${param('aid', affiliateId)}${param('label', 'nearby-offline-area')}`;
}
