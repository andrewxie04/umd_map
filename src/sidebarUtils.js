export const EMPTY_LIBCAL_BOOKING_STATE = {
  roomId: null,
  status: "idle",
  startDateTime: "",
  endDateTime: "",
  startOptions: [],
  durationOptions: [],
  holdMessage: "",
  summaryRows: [],
  termsHtml: "",
  bookingContext: null,
  fields: [],
  fieldValues: {},
  submitLabel: "Submit Booking",
  error: null,
  successHtml: "",
  showForm: false,
};

export const EMPTY_LIBCAL_ROOM_BROWSER_STATE = {
  roomId: null,
  status: "idle",
  dateKey: null,
  error: null,
  room: null,
};

export const EMPTY_DINING_BROWSER_STATE = {
  hallId: null,
  status: "idle",
  dateKey: null,
  error: null,
  hall: null,
};

export const CAPACITY_FILTER_OPTIONS = [
  { key: "all", label: "All", minCapacity: 0 },
  { key: "20", label: "20+", minCapacity: 20 },
  { key: "50", label: "50+", minCapacity: 50 },
  { key: "100", label: "100+", minCapacity: 100 },
  { key: "150", label: "150+", minCapacity: 150 },
];

export async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to a DOM-based fallback.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable in this browser.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard copy command failed.");
    }
    return true;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function getSafeExternalUrl(url, { allowHttp = false } = {}) {
  if (!url || typeof window === "undefined") return null;

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === "https:") return parsed.toString();
    if (allowHttp && parsed.protocol === "http:") return parsed.toString();
    return null;
  } catch (_) {
    return null;
  }
}

export function openSafeExternalUrl(url, options = {}) {
  const safeUrl = getSafeExternalUrl(url, options);
  if (!safeUrl) return false;
  window.open(safeUrl, "_blank", "noopener,noreferrer");
  return true;
}

export function getCapacityOptionsForRooms(rooms) {
  const maxCapacity = Math.max(
    0,
    ...(Array.isArray(rooms) ? rooms : []).map((room) => Number(room.capacity) || 0)
  );

  return CAPACITY_FILTER_OPTIONS.filter(
    (option) => option.key === "all" || maxCapacity >= option.minCapacity
  );
}

export function roomMatchesCapacityFilter(room, capacityFilterKey) {
  if (capacityFilterKey === "all") return true;
  const option = CAPACITY_FILTER_OPTIONS.find((candidate) => candidate.key === capacityFilterKey);
  if (!option) return true;
  const capacity = Number(room?.capacity);
  return Number.isFinite(capacity) && capacity >= option.minCapacity;
}

export function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.endsWith("ies") && word.length > 4) {
        return `${word.slice(0, -3)}y`;
      }
      if (word.endsWith("ses") && word.length > 4) {
        return word.slice(0, -2);
      }
      if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
        return word.slice(0, -1);
      }
      return word;
    })
    .join(" ");
}

export function getRoomSearchHaystack(room) {
  const parts = [room?.name, room?.type];

  if (room?.has_projector) parts.push("projector");
  if (room?.has_whiteboard) parts.push("whiteboard");
  if (room?.has_computers) parts.push("computers", "computer");
  if (room?.source === "libcal") parts.push("study room", "bookable room", "library room");
  if (room?.type === "Large Lecture Hall" || room?.type === "Small Lecture Hall") {
    parts.push("lecture hall", "lecture halls");
  }

  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

export function roomMatchesSearchQuery(room, query) {
  if (!query) return true;
  const normalizedQuery = normalizeSearchText(query);
  const roomSearchText = getRoomSearchHaystack(room);
  return roomSearchText.includes(normalizedQuery);
}
