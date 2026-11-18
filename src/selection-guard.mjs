/**
 * Framework-free helpers for handling user-supplied list entries.
 * This module intentionally contains no application-specific data or identifiers.
 */
export function escapeMarkup(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

export function safeImageAddress(value) {
  const address = String(value == null ? '' : value).trim()
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  if (!address) return '';
  if (/^data\s*:\s*image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|avif)\s*;/i.test(address)) return address;
  if (/^https?:\/\//i.test(address) || /^blob:/i.test(address) || /^(?:\.|\/)/.test(address)) return address;
  return '';
}

export function selectableMarkup(records) {
  if (!Array.isArray(records)) return '';
  return records.filter(record => record && record.id != null &&
    String(record.id).trim()).map(record => {
      const src = safeImageAddress(record.avatar);
      const image = src ? '<img alt="" src="' + escapeMarkup(src) + '">' : '';
      return '<div data-id="' + escapeMarkup(record.id) + '">' +
        image + '<span>' + escapeMarkup(record.name || 'Unnamed') + '</span></div>';
    }).join('');
}
