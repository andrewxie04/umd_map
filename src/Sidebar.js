import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import "./Sidebar.css";
import { getClassroomAvailability, getAvailableUntil, getAvailableForHours } from "./availability";
import { format } from "date-fns";

/* ============================================
   SVG Icons
   ============================================ */
const Icon = {
  search: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  x: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  star: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  starOutline: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  chevron: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  back: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  sun: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  directions: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  ),
  share: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
};

const haptic = () => navigator.vibrate && navigator.vibrate(10);

/* ============================================
   Sidebar Component
   ============================================ */
const Sidebar = ({
  onBuildingSelect,
  selectedBuilding,
  selectedStartDateTime,
  selectedEndDateTime,
  onStartDateTimeChange,
  onEndDateTimeChange,
  darkMode,
  toggleDarkMode,
  favoriteBuildings,
  favoriteRooms,
  toggleFavoriteBuilding,
  toggleFavoriteRoom,
  mapSelectionMode,
  onNavigateToBuilding,
  userLocation,
  pendingBuildingCode,
  pendingRoom,
}) => {
  // --- State ---
  const [buildings, setBuildings] = useState([]);
  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [isNow, setIsNow] = useState(true);
  const [showFavorites, setShowFavorites] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [sheetSnap, setSheetSnap] = useState("collapsed");
  const [focusedBuildingMode, setFocusedBuildingMode] = useState(false);
  const [durationFilter, setDurationFilter] = useState(0);
  const [sortMode, setSortMode] = useState("az");

  // --- Refs ---
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const handleRef = useRef(null);
  const dragHeaderRef = useRef(null);
  const buildingRefs = useRef({});
  const searchInputRef = useRef(null);
  const dragState = useRef({
    isDragging: false,
    startY: 0,
    startTranslate: 0,
    currentTranslate: 0,
    lastY: 0,
    lastTime: 0,
    velocity: 0,
  });

  // --- Snap point calculations ---
  const getSnapValues = useCallback(() => {
    const vh = window.innerHeight;
    return {
      collapsed: vh - 160,
      half: vh * 0.42,
      full: 50,
    };
  }, []);

  const getSnapTranslate = useCallback(
    (snap) => getSnapValues()[snap],
    [getSnapValues]
  );

  // --- Data loading ---
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + "/buildings_data.json")
      .then((r) => {
        if (!r.ok) throw new Error("Network response was not ok");
        return r.json();
      })
      .then((data) => {
        setBuildings(data.slice().sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => console.error("Error loading building data:", err));
  }, []);

  // --- Mobile detection ---
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setSheetSnap("collapsed");
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // --- Apply sheet position ---
  useEffect(() => {
    if (!isMobile || !sheetRef.current) return;
    const el = sheetRef.current;
    el.style.transition = "transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = `translateY(${getSnapTranslate(sheetSnap)}px)`;
  }, [sheetSnap, isMobile, getSnapTranslate]);

  // --- Selected building sync ---
  useEffect(() => {
    if (selectedBuilding) {
      const match = buildings.find((b) => b.code === selectedBuilding.code);
      setExpandedBuilding(match);
      setSelectedClassroom(null);

      if (mapSelectionMode) {
        setFocusedBuildingMode(true);
        if (isMobile) setSheetSnap("half");
      } else {
        setFocusedBuildingMode(false);
      }

      // Scroll to building on desktop
      if (
        !isMobile &&
        buildingRefs.current[selectedBuilding.code] &&
        scrollRef.current
      ) {
        const el = buildingRefs.current[selectedBuilding.code];
        scrollRef.current.scrollTo({
          top: Math.max(0, el.offsetTop - 80),
          behavior: "smooth",
        });
      }
    } else {
      setExpandedBuilding(null);
      setSelectedClassroom(null);
      setFocusedBuildingMode(false);
    }
  }, [selectedBuilding, buildings, mapSelectionMode, isMobile]);

  // --- Bottom sheet drag handlers (imperative for { passive: false }) ---
  // We store the latest sheetSnap in a ref so the listeners always see current value
  const sheetSnapRef = useRef(sheetSnap);
  useEffect(() => { sheetSnapRef.current = sheetSnap; }, [sheetSnap]);

  useEffect(() => {
    const handle = handleRef.current;
    const header = dragHeaderRef.current;
    if ((!handle && !header) || !isMobile) return;

    const onTouchStart = (e) => {
      // Skip drag handling if touch started on an interactive element
      const target = e.target;
      if (target.closest('button, a, input, select, [role="button"]')) {
        dragState.current.isDragging = false;
        return;
      }

      const touch = e.touches[0];
      const state = dragState.current;
      state.isDragging = true;
      state.startY = touch.clientY;
      state.startTranslate = getSnapTranslate(sheetSnapRef.current);
      state.currentTranslate = state.startTranslate;
      state.lastY = touch.clientY;
      state.lastTime = Date.now();
      state.startTime = Date.now();
      state.totalMove = 0;
      state.velocity = 0;

      if (sheetRef.current) {
        sheetRef.current.style.transition = "none";
      }
    };

    const onTouchMove = (e) => {
      const state = dragState.current;
      if (!state.isDragging) return;
      e.preventDefault(); // Prevent browser scroll — requires { passive: false }

      const touch = e.touches[0];
      const deltaY = touch.clientY - state.startY;
      const now = Date.now();
      const dt = now - state.lastTime;

      if (dt > 0) {
        state.velocity = (touch.clientY - state.lastY) / dt;
      }
      state.totalMove += Math.abs(touch.clientY - state.lastY);
      state.lastY = touch.clientY;
      state.lastTime = now;

      const snaps = getSnapValues();
      const newTranslate = state.startTranslate + deltaY;
      const clamped = Math.max(
        snaps.full - 30,
        Math.min(newTranslate, snaps.collapsed + 50)
      );
      state.currentTranslate = clamped;

      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${clamped}px)`;
      }
    };

    const onTouchEnd = () => {
      const state = dragState.current;
      if (!state.isDragging) return;
      state.isDragging = false;

      const elapsed = Date.now() - state.startTime;
      const snaps = getSnapValues();

      // Tap detection: short duration, minimal movement
      if (elapsed < 250 && state.totalMove < 8) {
        const cur = sheetSnapRef.current;
        const targetSnap = cur === "collapsed" ? "half" : "collapsed";
        if (sheetRef.current) {
          sheetRef.current.style.transition =
            "transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)";
          sheetRef.current.style.transform = `translateY(${snaps[targetSnap]}px)`;
        }
        setSheetSnap(targetSnap);
        return;
      }

      const currentY = state.currentTranslate;
      const velocity = state.velocity;

      let targetSnap;
      if (Math.abs(velocity) > 0.4) {
        if (velocity > 0) {
          targetSnap = currentY < snaps.half ? "half" : "collapsed";
        } else {
          targetSnap = currentY > snaps.half ? "half" : "full";
        }
      } else {
        const distances = [
          { snap: "full", dist: Math.abs(currentY - snaps.full) },
          { snap: "half", dist: Math.abs(currentY - snaps.half) },
          { snap: "collapsed", dist: Math.abs(currentY - snaps.collapsed) },
        ];
        distances.sort((a, b) => a.dist - b.dist);
        targetSnap = distances[0].snap;
      }

      if (sheetRef.current) {
        sheetRef.current.style.transition =
          "transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)";
        sheetRef.current.style.transform = `translateY(${snaps[targetSnap]}px)`;
      }
      setSheetSnap(targetSnap);
    };

    const targets = [handle, header].filter(Boolean);
    targets.forEach((el) => {
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove", onTouchMove, { passive: false });
      el.addEventListener("touchend", onTouchEnd, { passive: true });
    });

    return () => {
      targets.forEach((el) => {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", onTouchEnd);
      });
    };
  }, [isMobile, getSnapValues, getSnapTranslate]);

  // --- URL auto-select ---
  useEffect(() => {
    if (!pendingBuildingCode || buildings.length === 0) return;
    const match = buildings.find(
      (b) => b.code.toLowerCase() === pendingBuildingCode.toLowerCase()
    );
    if (match) {
      setExpandedBuilding(match);
      if (onBuildingSelect) onBuildingSelect(match, false);

      // If URL also has start/end params, switch to schedule mode
      const params = new URLSearchParams(window.location.search);
      if (params.get('start') && params.get('end')) {
        setIsNow(false);
      }

      // If URL has a room param, auto-select it
      if (pendingRoom) {
        const roomMatch = match.classrooms.find(
          (r) => r.name.toLowerCase() === pendingRoom.toLowerCase()
        );
        if (roomMatch) setSelectedClassroom(roomMatch);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBuildingCode, pendingRoom, buildings, onBuildingSelect]);

  // --- Haversine distance (meters) ---
  function haversineDistance(lng1, lat1, lng2, lat2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getWalkingMinutes(building) {
    if (!userLocation) return null;
    const dist = haversineDistance(
      userLocation.lng, userLocation.lat,
      building.longitude, building.latitude
    );
    return Math.round(dist / 80);
  }

  // --- Share handlers ---
  const handleShare = async (building) => {
    haptic();
    const url = `${window.location.origin}${window.location.pathname}?building=${building.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: building.name, url });
      } catch (_) {}
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  const handleShareRoom = async (building, room) => {
    haptic();
    const base = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams();
    params.set('building', building.code);
    params.set('room', room.name);

    if (!isNow) {
      params.set('start', selectedStartDateTime.toISOString());
      params.set('end', selectedEndDateTime.toISOString());
    }

    const url = `${base}?${params.toString()}`;

    // Build formatted text
    const lines = [];
    lines.push(`📍 ${building.name} — ${room.name}`);
    if (!isNow) {
      const dateStr = format(selectedStartDateTime, "EEE, MMM d");
      const startStr = format(selectedStartDateTime, "h:mm a");
      const endStr = format(selectedEndDateTime, "h:mm a");
      lines.push(`📅 ${dateStr}`);
      lines.push(`🕐 ${startStr} – ${endStr}`);
    }
    lines.push('');
    lines.push(url);

    const text = lines.join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: `${building.name} — ${room.name}`, text });
      } catch (_) {}
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  // --- Handlers ---
  const handleBuildingClick = (building) => {
    haptic();
    setFocusedBuildingMode(false);
    const isCollapsing = expandedBuilding && expandedBuilding.code === building.code;
    setExpandedBuilding((prev) =>
      prev && prev.code === building.code ? null : building
    );
    setSelectedClassroom(null);
    if (onBuildingSelect) onBuildingSelect(building, false);

    // Sync URL
    const url = new URL(window.location);
    if (isCollapsing) {
      url.searchParams.delete('building');
    } else {
      url.searchParams.set('building', building.code);
    }
    window.history.replaceState({}, '', url);
  };

  const handleClassroomClick = (classroom) => {
    haptic();
    setSelectedClassroom((prev) =>
      prev && prev.id === classroom.id ? null : classroom
    );
  };

  const handleExitFocusMode = () => {
    haptic();
    setFocusedBuildingMode(false);
    onBuildingSelect(null, false);
    if (isMobile) setSheetSnap("collapsed");
  };

  const handleModeChange = (nowMode) => {
    if (nowMode === isNow) return;
    haptic();
    setIsNow(nowMode);
    if (nowMode) {
      onStartDateTimeChange(new Date());
      onEndDateTimeChange(new Date());
    }
  };

  const handleSearchFocus = () => {
    if (isMobile && sheetSnap !== "full") {
      setSheetSnap("full");
    }
  };

  // --- Date/Time handlers (native inputs) ---
  const handleStartDateChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split("-").map(Number);
    onStartDateTimeChange((prev) => {
      const dt = new Date(prev);
      dt.setFullYear(y, m - 1, d);
      return dt;
    });
  };

  const handleStartTimeChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const [h, min] = val.split(":").map(Number);
    onStartDateTimeChange((prev) => {
      const dt = new Date(prev);
      dt.setHours(h, min, 0, 0);
      return dt;
    });
  };

  const handleEndDateChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split("-").map(Number);
    onEndDateTimeChange((prev) => {
      const dt = new Date(prev);
      dt.setFullYear(y, m - 1, d);
      return dt;
    });
  };

  const handleEndTimeChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const [h, min] = val.split(":").map(Number);
    onEndDateTimeChange((prev) => {
      const dt = new Date(prev);
      dt.setHours(h, min, 0, 0);
      return dt;
    });
  };

  // --- Filtering ---
  const isBuildingFavorite = (code) =>
    favoriteBuildings.some((b) => b.code === code);
  const isRoomFavorite = (id) => favoriteRooms.some((r) => r.id === id);

  const filteredBuildings = useMemo(() => {
    let base = buildings;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      base = base
        .map((b) => {
          const buildingMatches =
            b.name.toLowerCase().includes(q) ||
            (b.code && b.code.toLowerCase().includes(q));
          const matchingRooms = b.classrooms.filter((r) =>
            r.name.toLowerCase().includes(q)
          );
          if (buildingMatches || matchingRooms.length > 0) {
            return {
              ...b,
              classrooms: buildingMatches ? b.classrooms : matchingRooms,
            };
          }
          return null;
        })
        .filter(Boolean);
    }

    // Favorites filter
    if (showFavorites) {
      const favBuildingCodes = favoriteBuildings.map((b) => b.code);
      const favRoomBuildingCodes = favoriteRooms.map((r) => r.buildingCode);
      const allCodes = [...new Set([...favBuildingCodes, ...favRoomBuildingCodes])];

      base = base.filter((b) => allCodes.includes(b.code));
      return base.map((b) => {
        if (favBuildingCodes.includes(b.code)) return b;
        const favIds = favoriteRooms.filter((r) => r.buildingCode === b.code).map((r) => r.id);
        return { ...b, classrooms: b.classrooms.filter((r) => favIds.includes(r.id)) };
      });
    }

    // Availability filter in schedule mode
    if (!isNow) {
      base = base
        .map((b) => {
          const available = b.classrooms.filter(
            (r) =>
              getClassroomAvailability(r, selectedStartDateTime, selectedEndDateTime) === "Available"
          );
          return available.length > 0 ? { ...b, classrooms: available } : null;
        })
        .filter(Boolean);
    }

    // Duration filter (Now mode only)
    if (isNow && durationFilter > 0) {
      base = base
        .map((b) => {
          const filtered = b.classrooms.filter(
            (r) => getAvailableForHours(r) >= durationFilter
          );
          return filtered.length > 0 ? { ...b, classrooms: filtered } : null;
        })
        .filter(Boolean);
    }

    // Sort
    if (sortMode === "available") {
      base = base.slice().sort((a, b) => countAvailable(b) - countAvailable(a));
    } else if (sortMode === "distance" && userLocation) {
      base = base.slice().sort((a, b) => {
        const da = haversineDistance(userLocation.lng, userLocation.lat, a.longitude, a.latitude);
        const db = haversineDistance(userLocation.lng, userLocation.lat, b.longitude, b.latitude);
        return da - db;
      });
    }
    // "az" is default sort from data loading

    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    buildings,
    selectedStartDateTime,
    selectedEndDateTime,
    isNow,
    showFavorites,
    favoriteBuildings,
    favoriteRooms,
    searchQuery,
    durationFilter,
    sortMode,
    userLocation,
  ]);

  // --- Classroom schedule ---
  const classroomSchedule = useMemo(() => {
    if (!selectedClassroom) return [];
    const date = isNow ? new Date() : selectedStartDateTime;
    const dateStr = format(date, "yyyy-MM-dd");
    const schedule = selectedClassroom.availability_times
      .filter((t) => t.date.split("T")[0] === dateStr)
      .sort((a, b) => parseFloat(a.time_start) - parseFloat(b.time_start));
    return schedule;
  }, [selectedClassroom, selectedStartDateTime, isNow]);

  // --- Campus closed detection ---
  const campusClosedInfo = useMemo(() => {
    if (!isNow) return null;
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours() + now.getMinutes() / 60;

    const isWeekend = day === 0 || day === 6;
    const isAfterHours = hour < 7 || hour >= 22;

    if (!isWeekend && !isAfterHours) return null;

    // Calculate next opening
    let opensAt = new Date(now);
    if (isWeekend) {
      // Jump to next Monday
      const daysUntilMon = day === 0 ? 1 : 2;
      opensAt.setDate(opensAt.getDate() + daysUntilMon);
      opensAt.setHours(7, 0, 0, 0);
    } else if (hour >= 22) {
      // Opens tomorrow (or Monday if Friday night)
      opensAt.setDate(opensAt.getDate() + (day === 5 ? 3 : 1));
      opensAt.setHours(7, 0, 0, 0);
    } else {
      // Before 7am today
      opensAt.setHours(7, 0, 0, 0);
    }

    const diffMs = opensAt - now;
    const diffHours = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);

    const countdown =
      diffHours > 0
        ? `${diffHours}h ${diffMins}m`
        : `${diffMins}m`;

    const showDayName = (day === 5 && hour >= 22) || isWeekend;
    const opensLabel = format(opensAt, showDayName ? "EEEE 'at' h:mm a" : "'at' h:mm a");

    const messages = [
      "Testudo is sleeping",
      "The classrooms are resting",
      "Campus is on standby",
      "Even Testudo needs a break",
      "The halls are quiet tonight",
      "McKeldin is dreaming of finals week",
    ];
    const msgIndex = Math.floor(now.getTime() / 3600000) % messages.length;

    return {
      message: messages[msgIndex],
      countdown,
      opensLabel,
      isWeekend,
    };
  }, [isNow]);

  // --- Utility ---
  function decimalToTimeString(dec) {
    const d = parseFloat(dec);
    const h = Math.floor(d);
    const m = Math.round((d - h) * 60);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    return format(date, "h:mm a");
  }

  function decimalToDate(baseDate, dec) {
    const d = parseFloat(dec);
    const h = Math.floor(d);
    const m = Math.round((d - h) * 60);
    const date = new Date(baseDate);
    date.setHours(h, m, 0, 0);
    return date;
  }

  // Count available rooms for a building
  function countAvailable(building) {
    return building.classrooms.filter(
      (r) =>
        getClassroomAvailability(
          r,
          isNow ? null : selectedStartDateTime,
          isNow ? null : selectedEndDateTime
        ) === "Available"
    ).length;
  }

  /* ============================================
     RENDER
     ============================================ */

  const sidebarClasses = [
    "sidebar",
    isMobile ? "sidebar--sheet" : "sidebar--panel",
    darkMode ? "dark-mode" : "",
    focusedBuildingMode ? "sidebar--focused" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={sheetRef} className={sidebarClasses}>
      {/* --- Bottom sheet drag handle (mobile only) --- */}
      {isMobile && (
        <div className="sheet-handle" ref={handleRef}>
          <div className="handle-bar" />
        </div>
      )}

      {/* --- Scrollable content --- */}
      <div className="sidebar-scroll" ref={scrollRef}>
        {/* Header */}
        {focusedBuildingMode ? (
          <div className="sidebar-header sidebar-header--focused" ref={isMobile ? dragHeaderRef : undefined}>
            <button className="back-btn" onClick={handleExitFocusMode}>
              {Icon.back}
              <span>Back</span>
            </button>
            <h1 className="header-title header-title--sm">
              {selectedBuilding?.name || "Building"}
            </h1>
          </div>
        ) : (
          <div className="sidebar-header" ref={isMobile ? dragHeaderRef : undefined}>
            <h1 className="header-title">Rooms</h1>
            <div className="header-actions">
              <button
                className={`icon-btn ${showFavorites ? "icon-btn--active" : ""}`}
                onClick={() => { haptic(); setShowFavorites((p) => !p); }}
                aria-label={showFavorites ? "Show all" : "Show favorites"}
              >
                {showFavorites ? Icon.star : Icon.starOutline}
              </button>
              <button
                className="icon-btn"
                onClick={() => { haptic(); toggleDarkMode(); }}
                aria-label={darkMode ? "Light mode" : "Dark mode"}
              >
                {darkMode ? Icon.sun : Icon.moon}
              </button>
            </div>
          </div>
        )}

        {/* Search bar */}
        {!focusedBuildingMode && (
          <div className="search-bar">
            <span className="search-bar-icon">{Icon.search}</span>
            <input
              ref={searchInputRef}
              type="text"
              className="search-bar-input"
              placeholder="Search buildings or rooms"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={handleSearchFocus}
            />
            {searchQuery && (
              <button
                className="search-bar-clear"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                {Icon.x}
              </button>
            )}
          </div>
        )}

        {/* Segmented control */}
        {!focusedBuildingMode && (
          <div className="segmented-control">
            <div
              className="segment-slider"
              style={{ transform: `translateX(${isNow ? "0" : "100"}%)` }}
            />
            <button
              className={`segment ${isNow ? "segment--active" : ""}`}
              onClick={() => handleModeChange(true)}
            >
              Now
            </button>
            <button
              className={`segment ${!isNow ? "segment--active" : ""}`}
              onClick={() => handleModeChange(false)}
            >
              Schedule
            </button>
          </div>
        )}

        {/* Duration filter chips (Now mode only) */}
        {isNow && !focusedBuildingMode && (
          <div className="filter-chips">
            {[
              { label: "Any", value: 0 },
              { label: "1+ hr", value: 1 },
              { label: "2+ hr", value: 2 },
              { label: "3+ hr", value: 3 },
            ].map((chip) => (
              <button
                key={chip.value}
                className={`filter-chip ${durationFilter === chip.value ? "filter-chip--active" : ""}`}
                onClick={() => { haptic(); setDurationFilter(chip.value); }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Date/Time pickers (schedule mode) */}
        {!isNow && !focusedBuildingMode && (
          <div className="datetime-section">
            <div className="datetime-card">
              <span className="datetime-label">Start</span>
              <div className="datetime-inputs">
                <input
                  type="date"
                  className="ios-input"
                  value={format(selectedStartDateTime, "yyyy-MM-dd")}
                  onChange={handleStartDateChange}
                />
                <input
                  type="time"
                  className="ios-input"
                  value={format(selectedStartDateTime, "HH:mm")}
                  onChange={handleStartTimeChange}
                  min="07:00"
                  max="22:00"
                  step="1800"
                />
              </div>
            </div>
            <div className="datetime-card">
              <span className="datetime-label">End</span>
              <div className="datetime-inputs">
                <input
                  type="date"
                  className="ios-input"
                  value={format(selectedEndDateTime, "yyyy-MM-dd")}
                  onChange={handleEndDateChange}
                />
                <input
                  type="time"
                  className="ios-input"
                  value={format(selectedEndDateTime, "HH:mm")}
                  onChange={handleEndTimeChange}
                  min="07:00"
                  max="22:00"
                  step="1800"
                />
              </div>
            </div>
          </div>
        )}

        {/* Section header */}
        {!focusedBuildingMode && (
          <div className="section-header">
            <span className="section-header-text">
              {showFavorites
                ? "Favorites"
                : searchQuery
                ? `${filteredBuildings.length} result${filteredBuildings.length !== 1 ? "s" : ""}`
                : `${filteredBuildings.length} buildings`}
            </span>
            <select
              className="sort-select"
              value={sortMode}
              onChange={(e) => { haptic(); setSortMode(e.target.value); }}
            >
              <option value="az">A–Z</option>
              <option value="available">Most Available</option>
              {userLocation && <option value="distance">Nearest</option>}
            </select>
          </div>
        )}

        {/* Building list */}
        {campusClosedInfo && !focusedBuildingMode && !showFavorites && !searchQuery ? (
          <div className="closed-state">
            <div className="closed-state-emoji">🐢</div>
            <p className="closed-state-title">{campusClosedInfo.message}</p>
            <p className="closed-state-sub">
              Campus is closed {campusClosedInfo.isWeekend ? "for the weekend" : "for the night"}
            </p>
            <div className="closed-state-countdown">
              <span className="closed-state-timer">{campusClosedInfo.countdown}</span>
              <span className="closed-state-label">until doors open {campusClosedInfo.opensLabel}</span>
            </div>
            <p className="closed-state-hint">
              Switch to Schedule to plan ahead
            </p>
          </div>
        ) : filteredBuildings.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-text">
              {showFavorites &&
              favoriteBuildings.length === 0 &&
              favoriteRooms.length === 0
                ? "No favorites yet. Tap the star on a building or room to save it."
                : "No available buildings for this time range."}
            </p>
          </div>
        ) : (
          <div className="list-group">
            {filteredBuildings.map((building) => {
              const isExpanded =
                expandedBuilding && expandedBuilding.code === building.code;
              const isSelected =
                selectedBuilding && selectedBuilding.code === building.code;
              const availCount = countAvailable(building);

              // In focused mode, only show the selected building
              if (focusedBuildingMode && !isSelected) return null;

              return (
                <div
                  key={building.code}
                  ref={(el) => (buildingRefs.current[building.code] = el)}
                  className={`list-row ${isSelected ? "list-row--selected" : ""}`}
                >
                  {/* Building row */}
                  <div
                    className="building-row"
                    onClick={() => handleBuildingClick(building)}
                  >
                    <div className="building-row-left">
                      <span className="building-name">{building.name}</span>
                      <span className="building-meta">
                        {building.code} &middot; {availCount}/{building.classrooms.length} available
                        {(() => {
                          const mins = getWalkingMinutes(building);
                          return mins !== null ? ` · ${mins} min walk` : '';
                        })()}
                      </span>
                    </div>
                    <div className="building-row-right">
                      {isExpanded && (
                        <>
                          <button
                            className="share-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShare(building);
                            }}
                            aria-label={`Share ${building.name}`}
                          >
                            {Icon.share}
                          </button>
                          <button
                            className="directions-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onNavigateToBuilding) {
                                onNavigateToBuilding({
                                  name: building.name,
                                  code: building.code,
                                  longitude: building.longitude,
                                  latitude: building.latitude,
                                });
                              }
                            }}
                            aria-label={`Directions to ${building.name}`}
                          >
                            {Icon.directions}
                          </button>
                        </>
                      )}
                      <button
                        className={`fav-btn ${isBuildingFavorite(building.code) ? "fav-btn--active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          haptic();
                          toggleFavoriteBuilding(building);
                        }}
                        aria-label={
                          isBuildingFavorite(building.code)
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                      >
                        {isBuildingFavorite(building.code)
                          ? Icon.star
                          : Icon.starOutline}
                      </button>
                      <span
                        className={`chevron-icon ${isExpanded ? "chevron-icon--open" : ""}`}
                      >
                        {Icon.chevron}
                      </span>
                    </div>
                  </div>

                  {/* Classroom list (expanded) */}
                  {isExpanded && (
                    <div className="classroom-list">
                      {building.classrooms.map((room) => {
                        const status = getClassroomAvailability(
                          room,
                          isNow ? null : selectedStartDateTime,
                          isNow ? null : selectedEndDateTime
                        );
                        const isSelectedRoom =
                          selectedClassroom && selectedClassroom.id === room.id;
                        const statusClass = status
                          .toLowerCase()
                          .replace(/\s+/g, "-");

                        return (
                          <div key={room.id}>
                            <div
                              className={`classroom-row ${isSelectedRoom ? "classroom-row--selected" : ""}`}
                              onClick={() => handleClassroomClick(room)}
                            >
                              <span className="classroom-name">{room.name}</span>
                              <div className="classroom-row-right">
                                <button
                                  className={`fav-btn fav-btn--sm ${isRoomFavorite(room.id) ? "fav-btn--active" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    haptic();
                                    toggleFavoriteRoom(building, room);
                                  }}
                                  aria-label={
                                    isRoomFavorite(room.id)
                                      ? "Remove from favorites"
                                      : "Add to favorites"
                                  }
                                >
                                  {isRoomFavorite(room.id)
                                    ? Icon.star
                                    : Icon.starOutline}
                                </button>
                                <span className={`status-badge status-badge--${statusClass}`}>
                                  <span className="status-dot" />
                                  {status}
                                  {isNow && status === "Available" && (() => {
                                    const until = getAvailableUntil(room);
                                    return until ? (
                                      <span className="available-until">until {until}</span>
                                    ) : null;
                                  })()}
                                </span>
                              </div>
                            </div>

                            {/* Room detail card */}
                            {isSelectedRoom && (
                              <div className="room-detail">
                                {/* Share room */}
                                <button
                                  className="room-share-btn"
                                  onClick={() => handleShareRoom(building, room)}
                                >
                                  {Icon.share}
                                  <span>{!isNow ? "Share Room & Time" : "Share Room"}</span>
                                </button>

                                {/* Room info */}
                                <div className="room-info-grid">
                                  <div className="room-info-item">
                                    <span className="room-info-label">Type</span>
                                    <span className="room-info-value">
                                      {room.type || "Classroom"}
                                    </span>
                                  </div>
                                  <div className="room-info-item">
                                    <span className="room-info-label">Floor</span>
                                    <span className="room-info-value">
                                      {room.floor ||
                                        (() => {
                                          const parts = room.name.split(" ");
                                          if (parts.length >= 2) {
                                            const num = parts[1];
                                            if (num.startsWith("0")) return "G";
                                            if (/^\d/.test(num)) return num.charAt(0);
                                          }
                                          return "1";
                                        })()}
                                    </span>
                                  </div>
                                  <div className="room-info-item room-info-item--wide">
                                    <span className="room-info-label">Features</span>
                                    <div className="feature-tags">
                                      <span className="feature-tag">Projector</span>
                                      <span className="feature-tag">Whiteboard</span>
                                      {room.name.includes("C") && (
                                        <span className="feature-tag">Computers</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Timeline */}
                                <div className="timeline-section">
                                  <span className="timeline-title">
                                    {isNow
                                      ? "Today's Schedule"
                                      : `Schedule for ${format(selectedStartDateTime, "MMM d")}`}
                                  </span>
                                  <div className="timeline-bar">
                                    {Array.from({ length: 15 }, (_, i) => {
                                      const hour = i + 7;
                                      const isBooked = classroomSchedule.some(
                                        (ev) => {
                                          const s = Math.floor(parseFloat(ev.time_start));
                                          const e = Math.ceil(parseFloat(ev.time_end));
                                          return hour >= s && hour < e;
                                        }
                                      );
                                      const currentHour = new Date().getHours();
                                      const isCurrent = isNow && hour === currentHour;

                                      return (
                                        <div
                                          key={hour}
                                          className={`tl-seg ${isBooked ? "tl-seg--booked" : "tl-seg--free"} ${isCurrent ? "tl-seg--now" : ""}`}
                                          title={`${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "pm" : "am"}: ${isBooked ? "Booked" : "Available"}`}
                                        />
                                      );
                                    })}
                                  </div>
                                  <div className="timeline-labels">
                                    <span>7am</span>
                                    <span>12pm</span>
                                    <span>5pm</span>
                                    <span>10pm</span>
                                  </div>
                                </div>

                                {/* Event list */}
                                <div className="event-list">
                                  <span className="event-list-title">Events</span>
                                  {classroomSchedule.length > 0 ? (
                                    classroomSchedule.map((ev, idx) => {
                                      const evStart = decimalToDate(
                                        isNow ? new Date() : selectedStartDateTime,
                                        ev.time_start
                                      );
                                      const evEnd = decimalToDate(
                                        isNow ? new Date() : selectedStartDateTime,
                                        ev.time_end
                                      );
                                      const now = new Date();
                                      const isActive = now >= evStart && now <= evEnd;

                                      return (
                                        <div
                                          key={idx}
                                          className={`event-row ${isActive ? "event-row--active" : ""}`}
                                        >
                                          <span className="event-time">
                                            {decimalToTimeString(ev.time_start)} –{" "}
                                            {decimalToTimeString(ev.time_end)}
                                          </span>
                                          <span className="event-name">
                                            {ev.event_name}
                                          </span>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="event-empty">
                                      No events scheduled
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom padding for safe area */}
        <div className="sidebar-bottom-pad" />
      </div>
    </div>
  );
};

export default Sidebar;
