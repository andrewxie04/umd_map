import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import "./Sidebar.css";
import { getClassroomAvailability, getAvailableUntil, getAvailableForHours, getOpeningSoonInfo, getLibCalNextAvailableInfo, isUniversityHoliday } from "./availability";
import { format } from "date-fns";
import {
  fetchLibCalAvailabilityForDate,
  fetchLibCalBookingForm,
  fetchLibCalBookingOptions,
  submitLibCalBooking,
} from "./libcalData";
import {
  fetchDiningHallsForDate,
  getDiningHoursLabel,
  getDiningStatusClassName,
  getDiningStatusInfo,
  getRecommendedDiningMealName,
  getRetailSubvenueStatusInfo,
  isRetailDiningVenue,
} from "./diningData";
import {
  playErrorHaptic,
  playSelectionHaptic,
  playSuccessHaptic,
  playToggleHaptic,
} from "./haptics";

const EMPTY_LIBCAL_BOOKING_STATE = {
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

const EMPTY_LIBCAL_ROOM_BROWSER_STATE = {
  roomId: null,
  status: "idle",
  dateKey: null,
  error: null,
  room: null,
};

const EMPTY_DINING_BROWSER_STATE = {
  hallId: null,
  status: "idle",
  dateKey: null,
  error: null,
  hall: null,
};

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
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  layers: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
      <path d="m4 12.5 8 4.5 8-4.5" />
      <path d="m4 17 8 4.5 8-4.5" />
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

/* ============================================
   Sidebar Component
   ============================================ */
const Sidebar = ({
  buildingsData,
  onBuildingSelect,
  selectedBuilding,
  selectedParking,
  selectedDining,
  selectedRoomId,
  onClearParking,
  onClearDining,
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
  durationFilter,
  onDurationFilterChange,
  mapVisibility,
  toggleMapLayer,
  onInfoButtonTripleClick,
  mapSelectionMode,
  onNavigateToBuilding,
  userLocation,
  pendingBuildingCode,
  pendingRoom,
  viewMode,
  onModeChange,
  availabilityReady,
  initialLoadState,
  dayFetchState,
  activeDateKey,
  onExitBuildingFocus,
}) => {
  const isNow = viewMode === "now";
  const showAllRooms = viewMode === "all";
  const availabilityStartTime = isNow ? null : selectedStartDateTime;
  const availabilityEndTime = viewMode === "schedule" ? selectedEndDateTime : availabilityStartTime;

  // --- State ---
  const buildings = useMemo(
    () => (Array.isArray(buildingsData) ? buildingsData : []),
    [buildingsData]
  );
  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAboutPanel, setShowAboutPanel] = useState(false);
  const [showMapSettings, setShowMapSettings] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [sheetSnap, setSheetSnap] = useState("collapsed");
  const [focusedBuildingMode, setFocusedBuildingMode] = useState(false);
  const focusedDiningMode = Boolean(selectedDining) && !focusedBuildingMode;
  const [sortMode, setSortMode] = useState("az");
  const [expandedEvents, setExpandedEvents] = useState(() => new Set());
  const [libcalBookingState, setLibcalBookingState] = useState(EMPTY_LIBCAL_BOOKING_STATE);
  const [libcalBrowseDateKey, setLibcalBrowseDateKey] = useState(activeDateKey);
  const [libcalRoomBrowserState, setLibcalRoomBrowserState] = useState(EMPTY_LIBCAL_ROOM_BROWSER_STATE);
  const [selectedDiningMealName, setSelectedDiningMealName] = useState("");
  const [diningBrowseDateKey, setDiningBrowseDateKey] = useState(activeDateKey);
  const [diningBrowserState, setDiningBrowserState] = useState(EMPTY_DINING_BROWSER_STATE);
  const infoTapHistoryRef = useRef([]);
  const useScrollableMobileLayout = isMobile;
  const activeDateLabel = useMemo(() => {
    if (!activeDateKey) return "";
    const parsed = new Date(`${activeDateKey}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? activeDateKey : format(parsed, "EEE, MMM d");
  }, [activeDateKey]);
  const isInitialAvailabilityLoading =
    initialLoadState?.status === "loading" && buildings.length === 0;
  const isDayAvailabilityLoading =
    dayFetchState?.status === "loading" && dayFetchState?.dateKey === activeDateKey;
  const hasAvailabilityError =
    (initialLoadState?.status === "error" && buildings.length === 0) ||
    (dayFetchState?.status === "error" && dayFetchState?.dateKey === activeDateKey);
  const activeProgressState = isInitialAvailabilityLoading
    ? initialLoadState
    : isDayAvailabilityLoading
    ? dayFetchState
    : null;
  const shouldShowAvailabilityPlaceholder =
    !availabilityReady && (isInitialAvailabilityLoading || isDayAvailabilityLoading || hasAvailabilityError);

  const resetLibCalBookingState = useCallback(() => {
    setLibcalBookingState(EMPTY_LIBCAL_BOOKING_STATE);
  }, []);

  const getLibCalRoomPayload = useCallback((room) => ({
    eid: room?.libcal?.eid,
    gid: room?.libcal?.gid,
    lid: room?.libcal?.lid,
    name: room?.name,
    title: room?.libcal?.title || room?.name,
  }), []);

  const effectiveSelectedClassroom = useMemo(() => {
    if (
      selectedClassroom?.source === "libcal" &&
      libcalRoomBrowserState.roomId === selectedClassroom.id &&
      libcalRoomBrowserState.room
    ) {
      return {
        ...selectedClassroom,
        ...libcalRoomBrowserState.room,
        libcal: {
          ...(selectedClassroom.libcal || {}),
          ...(libcalRoomBrowserState.room.libcal || {}),
        },
      };
    }
    return selectedClassroom;
  }, [selectedClassroom, libcalRoomBrowserState]);

  const buildInitialLibCalFieldValues = useCallback((fields) => {
    const nextValues = {};
    (fields || []).forEach((field) => {
      if (field.type === "select") {
        nextValues[field.name] = "";
        return;
      }
      nextValues[field.name] = "";
    });
    return nextValues;
  }, []);

  const buildLibCalStartOptions = useCallback((block) => {
    const rawSlots = Array.isArray(block?.slots) && block.slots.length > 0
      ? block.slots
      : block?.start
      ? [{ start: block.start, end: block.end }]
      : [];

    const unique = new Map();
    rawSlots.forEach((slot) => {
      if (!slot?.start) return;
      if (!unique.has(slot.start)) {
        unique.set(slot.start, {
          start: slot.start,
          end: slot.end || "",
        });
      }
    });

    return Array.from(unique.values()).map((slot) => ({
      ...slot,
      label: formatLibCalDateTime(slot.start),
    }));
  }, []);

  // --- Refs ---
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const handleRef = useRef(null);
  const dragHeaderRef = useRef(null);
  const buildingRefs = useRef({});
  const searchInputRef = useRef(null);
  const libcalRoomCacheRef = useRef(new Map());
  const diningHallCacheRef = useRef(new Map());
  const selectedDiningRef = useRef(selectedDining);
  const activeDateKeyRef = useRef(activeDateKey);
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

  useEffect(() => {
    selectedDiningRef.current = selectedDining;
  }, [selectedDining]);

  useEffect(() => {
    activeDateKeyRef.current = activeDateKey;
  }, [activeDateKey]);

  // --- Apply sheet position ---
  useEffect(() => {
    if (!isMobile || useScrollableMobileLayout || !sheetRef.current) return;
    const el = sheetRef.current;
    el.style.transition = "transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = `translateY(${getSnapTranslate(sheetSnap)}px)`;
  }, [sheetSnap, isMobile, getSnapTranslate, useScrollableMobileLayout]);

  // --- Selected building sync ---
  useEffect(() => {
    if (selectedBuilding) {
      const match = buildings.find((b) => b.code === selectedBuilding.code);
      setExpandedBuilding(match);
      if (selectedRoomId && match) {
        const roomMatch = match.classrooms.find((room) => String(room.id) === String(selectedRoomId));
        setSelectedClassroom(roomMatch || null);
      } else {
        setSelectedClassroom(null);
      }

      if (mapSelectionMode) {
        setFocusedBuildingMode(true);
        if (isMobile && !useScrollableMobileLayout) setSheetSnap("half");
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
  }, [selectedBuilding, selectedRoomId, buildings, mapSelectionMode, isMobile, useScrollableMobileLayout]);

  useEffect(() => {
    resetLibCalBookingState();
  }, [selectedClassroom?.id, resetLibCalBookingState]);

  useEffect(() => {
    if (selectedClassroom?.source !== "libcal") {
      setLibcalBrowseDateKey(activeDateKey);
      setLibcalRoomBrowserState(EMPTY_LIBCAL_ROOM_BROWSER_STATE);
      return;
    }

    setLibcalBrowseDateKey(activeDateKey);
    setLibcalRoomBrowserState({
      roomId: selectedClassroom.id,
      status: "ready",
      dateKey: activeDateKey,
      error: null,
      room: selectedClassroom,
    });
  }, [selectedClassroom, activeDateKey]);

  useEffect(() => {
    if (selectedClassroom?.source !== "libcal" || !selectedClassroom?.id || !libcalBrowseDateKey) return;

    const cacheKey = `${selectedClassroom.id}:${libcalBrowseDateKey}`;
    if (libcalBrowseDateKey === activeDateKey) {
      setLibcalRoomBrowserState({
        roomId: selectedClassroom.id,
        status: "ready",
        dateKey: libcalBrowseDateKey,
        error: null,
        room: selectedClassroom,
      });
      return;
    }

    const cachedRoom = libcalRoomCacheRef.current.get(cacheKey);
    if (cachedRoom) {
      setLibcalRoomBrowserState({
        roomId: selectedClassroom.id,
        status: "ready",
        dateKey: libcalBrowseDateKey,
        error: null,
        room: cachedRoom,
      });
      return;
    }

    const controller = new AbortController();
    setLibcalRoomBrowserState((prev) => ({
      roomId: selectedClassroom.id,
      status: "loading",
      dateKey: libcalBrowseDateKey,
      error: null,
      room: prev.roomId === selectedClassroom.id ? prev.room : selectedClassroom,
    }));

    fetchLibCalAvailabilityForDate(libcalBrowseDateKey, { signal: controller.signal })
      .then((buildingsForDate) => {
        if (controller.signal.aborted) return;
        const matchingBuilding = buildingsForDate.find((building) => building.code === expandedBuilding?.code)
          || buildingsForDate.find((building) =>
            (building.classrooms || []).some((room) => String(room.id) === String(selectedClassroom.id))
          );
        const matchingRoom = matchingBuilding?.classrooms?.find(
          (room) => String(room.id) === String(selectedClassroom.id)
        );
        if (!matchingRoom) {
          throw new Error("Could not find that study room for the selected date.");
        }
        libcalRoomCacheRef.current.set(cacheKey, matchingRoom);
        setLibcalRoomBrowserState({
          roomId: selectedClassroom.id,
          status: "ready",
          dateKey: libcalBrowseDateKey,
          error: null,
          room: matchingRoom,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLibcalRoomBrowserState({
          roomId: selectedClassroom.id,
          status: "error",
          dateKey: libcalBrowseDateKey,
          error: error.message || "Could not load study-room availability for that date.",
          room: selectedClassroom,
        });
      });

    return () => controller.abort();
  }, [selectedClassroom, libcalBrowseDateKey, activeDateKey, expandedBuilding]);

  useEffect(() => {
    const currentDining = selectedDiningRef.current;
    if (!currentDining?.id) {
      setDiningBrowseDateKey(activeDateKeyRef.current);
      setDiningBrowserState(EMPTY_DINING_BROWSER_STATE);
      return;
    }

    const initialDateKey = currentDining.dateKey || activeDateKeyRef.current;
    setDiningBrowseDateKey(initialDateKey);
    setDiningBrowserState({
      hallId: currentDining.id,
      status: "ready",
      dateKey: initialDateKey,
      error: null,
      hall: currentDining,
    });
  }, [selectedDining?.id]);

  useEffect(() => {
    if (!selectedDining?.id || !diningBrowseDateKey) return;

    const activeDiningDateKey = selectedDining.dateKey || activeDateKey;
    if (diningBrowseDateKey === activeDiningDateKey) {
      setDiningBrowserState({
        hallId: selectedDining.id,
        status: "ready",
        dateKey: diningBrowseDateKey,
        error: null,
        hall: selectedDining,
      });
      return;
    }

    const cacheKey = `${selectedDining.id}:${diningBrowseDateKey}`;
    const cachedHall = diningHallCacheRef.current.get(cacheKey);
    if (cachedHall) {
      setDiningBrowserState({
        hallId: selectedDining.id,
        status: "ready",
        dateKey: diningBrowseDateKey,
        error: null,
        hall: cachedHall,
      });
      return;
    }

    const controller = new AbortController();
    setDiningBrowserState((prev) => ({
      hallId: selectedDining.id,
      status: "loading",
      dateKey: diningBrowseDateKey,
      error: null,
      hall: prev.hallId === selectedDining.id && prev.hall ? prev.hall : selectedDining,
    }));

    fetchDiningHallsForDate(diningBrowseDateKey, { signal: controller.signal })
      .then((hallsForDate) => {
        if (controller.signal.aborted) return;
        const matchingHall = hallsForDate.find((hall) => hall.id === selectedDining.id);
        if (!matchingHall) {
          throw new Error("No dining menu is posted for that day yet.");
        }

        diningHallCacheRef.current.set(cacheKey, matchingHall);
        setDiningBrowserState({
          hallId: selectedDining.id,
          status: "ready",
          dateKey: diningBrowseDateKey,
          error: null,
          hall: matchingHall,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDiningBrowserState((prev) => ({
          hallId: selectedDining.id,
          status: "error",
          dateKey: diningBrowseDateKey,
          error: error.message || "Could not load dining information for that date.",
          hall: prev.hallId === selectedDining.id && prev.hall ? prev.hall : selectedDining,
        }));
      });

    return () => controller.abort();
  }, [selectedDining, diningBrowseDateKey, activeDateKey]);

  // --- Bottom sheet drag handlers (imperative for { passive: false }) ---
  // We store the latest sheetSnap in a ref so the listeners always see current value
  const sheetSnapRef = useRef(sheetSnap);
  useEffect(() => { sheetSnapRef.current = sheetSnap; }, [sheetSnap]);

  useEffect(() => {
    const handle = handleRef.current;
    const header = dragHeaderRef.current;
    if ((!handle && !header) || !isMobile || useScrollableMobileLayout) return;

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
  }, [isMobile, getSnapValues, getSnapTranslate, useScrollableMobileLayout]);

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
        onModeChange("schedule");
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
    playSelectionHaptic();
    const url = `${window.location.origin}${window.location.pathname}?building=${building.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: building.name, url });
        playSuccessHaptic();
      } catch (_) {
        playErrorHaptic();
      }
    } else {
      await navigator.clipboard.writeText(url);
      playSuccessHaptic();
    }
  };

  const handleShareRoom = async (building, room) => {
    playSelectionHaptic();
    const base = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams();
    params.set('building', building.code);
    params.set('room', room.name);

    if (viewMode === "schedule") {
      params.set('start', selectedStartDateTime.toISOString());
      params.set('end', selectedEndDateTime.toISOString());
    }

    const url = `${base}?${params.toString()}`;

    // Build formatted text
    const lines = [];
    lines.push(`📍 ${building.name} — ${room.name}`);
    if (viewMode === "schedule") {
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
        playSuccessHaptic();
      } catch (_) {
        playErrorHaptic();
      }
    } else {
      await navigator.clipboard.writeText(text);
      playSuccessHaptic();
    }
  };

  const handleExternalDirections = (building) => {
    playSelectionHaptic();
    const lat = building.latitude;
    const lng = building.longitude;
    if (lat == null || lng == null) return;
    openExternalWalkingDirections(lat, lng);
  };

  const openExternalWalkingDirections = (lat, lng) => {
    if (lat == null || lng == null) return;

    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const url = isIOS
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openExternalBookingPage = (room) => {
    const bookingUrl = room?.libcal?.booking_url;
    if (!bookingUrl) return;
    playSelectionHaptic();
    window.open(bookingUrl, "_blank", "noopener,noreferrer");
  };

  const openDiningMenuPage = useCallback((hall) => {
    const pageUrl = hall?.pageUrl;
    if (!pageUrl) return;
    playSelectionHaptic();
    window.open(pageUrl, "_blank", "noopener,noreferrer");
  }, []);

  const handleDiningBrowseDay = (dayDelta) => {
    if (!diningBrowseDateKey) return;
    playSelectionHaptic();
    setDiningBrowseDateKey(shiftDateKey(diningBrowseDateKey, dayDelta));
  };

  const handleDiningBrowseDateChange = (value) => {
    if (!value) return;
    playSelectionHaptic();
    setDiningBrowseDateKey(value);
  };

  const handleDiningBrowseToday = () => {
    if (!activeDateKey) return;
    playSelectionHaptic();
    setDiningBrowseDateKey(activeDateKey);
  };

  const loadLibCalBookingOptions = useCallback(async (room, startDateTime, startOptions = []) => {
    const roomPayload = getLibCalRoomPayload(room);
    setLibcalBookingState((prev) => ({
      ...EMPTY_LIBCAL_BOOKING_STATE,
      roomId: room.id,
      status: "loading-options",
      startDateTime,
      startOptions: startOptions.length ? startOptions : prev.startOptions || [],
    }));

    try {
      const response = await fetchLibCalBookingOptions(roomPayload, startDateTime);
      setLibcalBookingState({
        ...EMPTY_LIBCAL_BOOKING_STATE,
        roomId: room.id,
        status: "options-ready",
        startDateTime: response?.startDateTime || startDateTime,
        endDateTime: response?.defaultEndDateTime || "",
        startOptions,
        durationOptions: response?.durationOptions || [],
      });
    } catch (error) {
      playErrorHaptic();
      setLibcalBookingState({
        ...EMPTY_LIBCAL_BOOKING_STATE,
        roomId: room.id,
        status: "error",
        startDateTime,
        startOptions,
        error: error.message || "Could not start the booking flow.",
      });
    }
  }, [getLibCalRoomPayload]);

  const handleStartLibCalBooking = async (room, block) => {
    if (!room?.libcal || !block?.start) return;
    playSelectionHaptic();

    const startOptions = buildLibCalStartOptions(block);
    const firstStart = startOptions[0]?.start || block.start;
    await loadLibCalBookingOptions(room, firstStart, startOptions);
  };

  const handleLibCalDurationChange = (value) => {
    setLibcalBookingState((prev) => ({
      ...prev,
      endDateTime: value,
    }));
  };

  const handleLibCalStartTimeChange = async (room, nextStartDateTime) => {
    if (!room?.libcal || !nextStartDateTime) return;
    playSelectionHaptic();
    await loadLibCalBookingOptions(room, nextStartDateTime, libcalBookingState.startOptions || []);
  };

  const handleLoadLibCalBookingForm = async (room) => {
    if (!room?.libcal || !libcalBookingState.startDateTime || !libcalBookingState.endDateTime) return;
    playSelectionHaptic();

    const roomPayload = getLibCalRoomPayload(room);
    setLibcalBookingState((prev) => ({
      ...prev,
      status: "loading-form",
      error: null,
    }));

    try {
      const response = await fetchLibCalBookingForm(
        roomPayload,
        libcalBookingState.startDateTime,
        libcalBookingState.endDateTime
      );

      setLibcalBookingState((prev) => ({
        ...prev,
        status: "form-ready",
        holdMessage: response?.holdMessage || "",
        summaryRows: response?.summaryRows || [],
        termsHtml: response?.termsHtml || "",
        bookingContext: response?.bookingContext || null,
        fields: response?.fields || [],
        fieldValues: buildInitialLibCalFieldValues(response?.fields || []),
        submitLabel: response?.submitLabel || "Submit Booking",
        showForm: !(response?.termsHtml || "").trim(),
        error: null,
      }));
    } catch (error) {
      playErrorHaptic();
      setLibcalBookingState((prev) => ({
        ...prev,
        status: "options-ready",
        error: error.message || "Could not load the booking form.",
      }));
    }
  };

  const handleRevealLibCalBookingForm = () => {
    playSelectionHaptic();
    setLibcalBookingState((prev) => ({
      ...prev,
      showForm: true,
    }));
  };

  const handleLibCalFieldChange = (name, value) => {
    setLibcalBookingState((prev) => ({
      ...prev,
      fieldValues: {
        ...prev.fieldValues,
        [name]: value,
      },
    }));
  };

  const handleSubmitLibCalBooking = async (room) => {
    if (!room?.libcal) return;
    playSelectionHaptic();

    const missingRequiredField = (libcalBookingState.fields || []).find((field) => {
      if (!field.required) return false;
      return !String(libcalBookingState.fieldValues?.[field.name] || "").trim();
    });

    if (missingRequiredField) {
      playErrorHaptic();
      setLibcalBookingState((prev) => ({
        ...prev,
        error: `${missingRequiredField.label} is required.`,
      }));
      return;
    }

    setLibcalBookingState((prev) => ({
      ...prev,
      status: "submitting",
      error: null,
    }));

    try {
      const response = await submitLibCalBooking(
        libcalBookingState.bookingContext,
        libcalBookingState.fieldValues
      );
      playSuccessHaptic();
      setLibcalBookingState((prev) => ({
        ...prev,
        status: "success",
        successHtml: response?.successHtml || "",
        error: null,
      }));
    } catch (error) {
      playErrorHaptic();
      setLibcalBookingState((prev) => ({
        ...prev,
        status: "form-ready",
        error: error.message || "Could not submit the booking.",
      }));
    }
  };

  // --- Handlers ---
  const handleBuildingClick = (building) => {
    playSelectionHaptic();
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
    playSelectionHaptic();
    setSelectedClassroom((prev) =>
      prev && prev.id === classroom.id ? null : classroom
    );
  };

  const handleExitFocusMode = () => {
    playSelectionHaptic();
    setFocusedBuildingMode(false);
    onBuildingSelect(null, false);
    if (onExitBuildingFocus) onExitBuildingFocus();
    if (isMobile && !useScrollableMobileLayout) setSheetSnap("collapsed");
  };

  const handleExitDiningFocus = () => {
    playSelectionHaptic();
    if (onClearDining) onClearDining();
    if (isMobile && !useScrollableMobileLayout) setSheetSnap("collapsed");
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === viewMode) return;
    playToggleHaptic();
    onModeChange(nextMode);
    if (nextMode !== "schedule") {
      onStartDateTimeChange(new Date());
      onEndDateTimeChange(new Date());
    }
  };

  const handleSearchFocus = () => {
    if (isMobile && !useScrollableMobileLayout && sheetSnap !== "full") {
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
    const trimmedQuery = searchQuery.toLowerCase().trim();
    const isSearching = trimmedQuery.length > 0;
    const campusClosedSnapshot = getCampusClosedSnapshot();

    // Search filter
    if (isSearching) {
      const searchDate = getSearchDateString();
      base = base
        .map((b) => {
          const buildingMatches =
            b.name.toLowerCase().includes(trimmedQuery) ||
            (b.code && b.code.toLowerCase().includes(trimmedQuery));
          const matchingRooms = b.classrooms.filter(
            (r) =>
              r.name.toLowerCase().includes(trimmedQuery) ||
              roomMatchesEventQuery(r, trimmedQuery, searchDate)
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
      const favBuildingCodes = new Set(favoriteBuildings.map((b) => b.code));
      const favRoomIdsByBuilding = new Map();

      for (const room of favoriteRooms) {
        const ids = favRoomIdsByBuilding.get(room.buildingCode) || new Set();
        ids.add(room.id);
        favRoomIdsByBuilding.set(room.buildingCode, ids);
      }

      base = base
        .map((b) => {
          if (favBuildingCodes.has(b.code)) return b;
          const favIds = favRoomIdsByBuilding.get(b.code);
          if (!favIds || favIds.size === 0) return null;

          const favoriteClassrooms = b.classrooms.filter((r) => favIds.has(r.id));
          return favoriteClassrooms.length > 0
            ? { ...b, classrooms: favoriteClassrooms }
            : null;
        })
        .filter(Boolean);
    }

    if (
      !isSearching &&
      !showFavorites &&
      !showAllRooms &&
      isNow &&
      campusClosedSnapshot
    ) {
      base = base
        .map((building) => {
          const matchingRooms = building.classrooms.filter((room) => {
            if (room.source !== "libcal") return false;
            const availableHours = getAvailableForHours(room);
            if (durationFilter > 0) {
              return availableHours >= durationFilter;
            }
            const status = getClassroomAvailability(room, availabilityStartTime, availabilityEndTime);
            return status === "Available" || status === "Opening Soon";
          });

          return matchingRooms.length > 0
            ? { ...building, classrooms: matchingRooms }
            : null;
        })
        .filter(Boolean);
    }

    // Availability filter in schedule mode
    if (!isSearching && !showAllRooms && viewMode === "schedule") {
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
    if (!isSearching && !showAllRooms && isNow && durationFilter > 0) {
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
    viewMode,
    showAllRooms,
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
    if (!effectiveSelectedClassroom) return [];
    if (effectiveSelectedClassroom.source === "libcal") {
      return (effectiveSelectedClassroom.libcal?.available_blocks || []).slice().sort((a, b) => a.time_start - b.time_start);
    }
    const date = isNow ? new Date() : selectedStartDateTime;
    const dateStr = format(date, "yyyy-MM-dd");
    const schedule = (effectiveSelectedClassroom.availability_times || [])
      .filter((t) =>
        t.date.split("T")[0] === dateStr &&
        parseFloat(t.time_start) < 22 &&
        parseFloat(t.time_start) >= 7
      )
      .sort((a, b) => parseFloat(a.time_start) - parseFloat(b.time_start));
    return schedule;
  }, [effectiveSelectedClassroom, selectedStartDateTime, isNow]);

  const renderedBuildings = useMemo(() => {
    if (!focusedBuildingMode) return filteredBuildings;

    const focusedCode =
      selectedBuilding?.code || expandedBuilding?.code || null;
    if (!focusedCode) return filteredBuildings;

    const fullBuilding =
      buildings.find((building) => building.code === focusedCode) ||
      selectedBuilding ||
      expandedBuilding;

    return fullBuilding ? [fullBuilding] : filteredBuildings;
  }, [
    focusedBuildingMode,
    filteredBuildings,
    buildings,
    selectedBuilding,
    expandedBuilding,
  ]);

  const selectedClassroomStatus = useMemo(() => {
    if (!effectiveSelectedClassroom || effectiveSelectedClassroom.source === "libcal") return null;
    return getClassroomAvailability(
      effectiveSelectedClassroom,
      availabilityStartTime,
      availabilityEndTime
    );
  }, [effectiveSelectedClassroom, availabilityStartTime, availabilityEndTime]);

  const roomMeetsDurationFilter = useCallback((room) => {
    if (!isNow || durationFilter <= 0) return true;
    return getAvailableForHours(room) >= durationFilter;
  }, [durationFilter, isNow]);

  const effectiveSelectedDining = useMemo(() => {
    if (
      selectedDining?.id &&
      diningBrowserState.hallId === selectedDining.id &&
      diningBrowserState.hall
    ) {
      return diningBrowserState.hall;
    }
    return selectedDining;
  }, [selectedDining, diningBrowserState]);

  const diningReferenceDateTime = useMemo(() => {
    const dateKey = effectiveSelectedDining?.dateKey || activeDateKey;
    if (!dateKey) return new Date();

    const now = new Date();
    const todayKey = format(now, "yyyy-MM-dd");
    if (dateKey === todayKey) {
      return now;
    }

    return new Date(`${dateKey}T12:00:00`);
  }, [effectiveSelectedDining?.dateKey, activeDateKey]);

  const selectedDiningStatus = useMemo(
    () => (effectiveSelectedDining ? getDiningStatusInfo(effectiveSelectedDining, diningReferenceDateTime) : null),
    [effectiveSelectedDining, diningReferenceDateTime]
  );

  const selectedDiningMeal = useMemo(() => {
    if (!effectiveSelectedDining) return null;
    return (
      (effectiveSelectedDining.meals || []).find((meal) => meal.name === selectedDiningMealName) ||
      (effectiveSelectedDining.meals || [])[0] ||
      null
    );
  }, [effectiveSelectedDining, selectedDiningMealName]);

  const selectedDiningHoursLabel = useMemo(
    () => (effectiveSelectedDining ? getDiningHoursLabel(effectiveSelectedDining, diningReferenceDateTime) : ""),
    [effectiveSelectedDining, diningReferenceDateTime]
  );

  useEffect(() => {
    if (!effectiveSelectedDining) {
      setSelectedDiningMealName("");
      return;
    }

    const nextMealName =
      getRecommendedDiningMealName(effectiveSelectedDining, diningReferenceDateTime) ||
      effectiveSelectedDining.meals?.[0]?.name ||
      "";
    setSelectedDiningMealName(nextMealName);
  }, [effectiveSelectedDining, diningReferenceDateTime]);

  // --- Campus closed detection ---
  function getCampusClosedSnapshot(referenceDate = new Date()) {
    const now = referenceDate;
    const day = now.getDay();
    const hour = now.getHours() + now.getMinutes() / 60;
    const isHoliday = isUniversityHoliday(now);

    const isWeekend = day === 0 || day === 6;
    const isAfterHours = hour < 7 || hour >= 22;

    if (!isWeekend && !isAfterHours && !isHoliday) return null;

    // Calculate next opening: find the next weekday at 7am
    let opensAt = new Date(now);
    opensAt.setHours(7, 0, 0, 0);

    if (now >= opensAt || isWeekend || isHoliday) {
      opensAt.setDate(opensAt.getDate() + 1);
    }
    // Skip weekends
    while (opensAt.getDay() === 0 || opensAt.getDay() === 6 || isUniversityHoliday(opensAt)) {
      opensAt.setDate(opensAt.getDate() + 1);
    }

    const diffMs = opensAt - now;
    const diffHours = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);

    const countdown =
      diffHours > 0
        ? `${diffHours}h ${diffMins}m`
        : `${diffMins}m`;

    const showDayName = diffMs > 24 * 3600000;
    const opensLabel = format(opensAt, showDayName ? "EEEE 'at' h:mm a" : "'at' h:mm a");

    const messages = [
      "Testudo is sleeping",
      "The classrooms are resting",
      "Campus is on standby",
      "Even Testudo needs a break",
      "The halls are quiet tonight",
      "McKeldin is dreaming of finals week",
      "Hornbake is whispering",
      "Stamp is lights out",
      "The mall is empty",
      "Lecture halls are in low power mode",
      "The whiteboards are blank",
      "Projectors are cooling down",
      "The quads are quiet",
      "The libraries are off duty",
      "Even the bells are taking a pause",
      "The campus is on airplane mode",
      "Silence on the sidewalks",
      "Terp time is napping",
      "The doors are locked for now",
    ];
    const msgIndex = Math.floor(now.getTime() / 3600000) % messages.length;

    return {
      message: messages[msgIndex],
      countdown,
      opensLabel,
      isWeekend,
      isHoliday,
    };
  }

  const campusClosedInfo = useMemo(() => {
    if (viewMode !== "now") return null;
    return getCampusClosedSnapshot();
  }, [viewMode]);

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

  function libCalHourFallsInBlock(hour, block) {
    const start = parseFloat(block?.time_start);
    const rawEnd = parseFloat(block?.time_end);
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return false;

    const end = rawEnd <= start ? rawEnd + 24 : rawEnd;
    const normalizedHour = hour < start ? hour + 24 : hour;
    return normalizedHour >= start && normalizedHour < end;
  }

  function parseDateKey(dateKey) {
    const parsed = new Date(`${dateKey}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function shiftDateKey(dateKey, offsetDays) {
    const next = parseDateKey(dateKey);
    next.setDate(next.getDate() + offsetDays);
    return format(next, "yyyy-MM-dd");
  }

  function formatHourTick(hour) {
    const normalized = ((hour % 24) + 24) % 24;
    if (normalized === 0) return "12am";
    if (normalized === 12) return "12pm";
    if (normalized < 12) return `${normalized}am`;
    return `${normalized - 12}pm`;
  }

  function formatLibCalDateTime(dateTimeString) {
    if (!dateTimeString) return "";
    const safeValue = String(dateTimeString).replace(" ", "T");
    const parsed = new Date(safeValue);
    if (Number.isNaN(parsed.getTime())) return dateTimeString;
    return format(parsed, "EEE, MMM d h:mm a");
  }

  function compactLibCalHoldMessage(message) {
    const raw = String(message || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    const match = raw.match(/held for you until\s+(.+?)\.\s/i);
    if (match?.[1]) {
      return `Held until ${match[1]}`;
    }
    return raw;
  }

  function parseEventNames(value) {
    const raw = String(value || "");
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return [...new Set(parts)];
  }

  const libcalBrowseDateLabel = useMemo(() => {
    const date = parseDateKey(libcalBrowseDateKey || activeDateKey);
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = format(tomorrow, "yyyy-MM-dd");
    const currentKey = format(date, "yyyy-MM-dd");
    if (currentKey === todayKey) return "Today";
    if (currentKey === tomorrowKey) return "Tomorrow";
    return format(date, "EEE, MMM d");
  }, [libcalBrowseDateKey, activeDateKey]);

  const handleLibCalBrowseDateChange = useCallback((nextDateKey) => {
    playSelectionHaptic();
    resetLibCalBookingState();
    setLibcalBrowseDateKey(nextDateKey);
  }, [resetLibCalBookingState]);

  function toggleEventExpansion(key) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function getSearchDateString() {
    const baseDate = isNow ? new Date() : selectedStartDateTime;
    return format(baseDate, "yyyy-MM-dd");
  }

  function roomMatchesEventQuery(room, query, dateString) {
    return (room.availability_times || []).some((timeRange) => {
      const eventDatePart = String(timeRange.date || "").split("T")[0];
      const eventName = String(timeRange.event_name || "").toLowerCase();
      return eventDatePart === dateString && eventName.includes(query);
    });
  }

  function getSourceBuilding(building) {
    return buildings.find((candidate) => candidate.code === building.code) || building;
  }

  // Count available rooms for a building
  function countAvailable(building) {
    const sourceBuilding = getSourceBuilding(building);
    return (sourceBuilding.classrooms || []).filter(
      (r) =>
        getClassroomAvailability(
          r,
          availabilityStartTime,
          availabilityEndTime
        ) === "Available"
    ).length;
  }

  function getBuildingMeta(building) {
    const sourceBuilding = getSourceBuilding(building);
    const available = countAvailable(building);
    const totalRooms = sourceBuilding.classrooms?.length || 0;
    const availabilityLabel = `${available}/${totalRooms} available`;
    const roomLabel = `${totalRooms} room${totalRooms !== 1 ? "s" : ""}`;
    const mins = getWalkingMinutes(building);
    return `${building.code} · ${showAllRooms ? roomLabel : availabilityLabel}${mins !== null ? ` · ${mins} min walk` : ""}`;
  }

  function getExpandedRoomsForBuilding(building) {
    const sourceBuilding = getSourceBuilding(building);
    const allRooms = Array.isArray(sourceBuilding.classrooms)
      ? sourceBuilding.classrooms.slice()
      : [];

    const getStatusRank = (room) => {
      const rawStatus = getClassroomAvailability(
        room,
        availabilityStartTime,
        availabilityEndTime
      );
      const status =
        isNow && durationFilter > 0 && rawStatus === "Available" && !roomMeetsDurationFilter(room)
          ? "Unavailable"
          : rawStatus;

      if (status === "Available") return 0;
      if (status === "Opening Soon") return 1;
      if (room.source === "libcal" && isNow && rawStatus === "Unavailable" && getLibCalNextAvailableInfo(room)) return 2;
      if (status === "Unavailable") return 3;
      if (status === "Closed") return 4;
      return 5;
    };

    return allRooms.sort((a, b) => {
      const rankDiff = getStatusRank(a) - getStatusRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function renderLibCalDateBrowser() {
    const selectedDate = libcalBrowseDateKey || activeDateKey;
    const loading = libcalRoomBrowserState.status === "loading";
    const hasError = libcalRoomBrowserState.status === "error";

    return (
      <div className="libcal-date-browser">
        <div className="libcal-date-browser-top">
          <span className="room-info-label">Booking Date</span>
        </div>
        <div className="libcal-date-browser-controls">
          <button
            className="libcal-date-browser-btn"
            onClick={() => handleLibCalBrowseDateChange(shiftDateKey(selectedDate, -1))}
            aria-label="Previous day"
          >
            {Icon.back}
          </button>
          <label className="libcal-date-browser-chip">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (!e.target.value) return;
                handleLibCalBrowseDateChange(e.target.value);
              }}
            />
            <span>{libcalBrowseDateLabel}</span>
          </label>
          <button
            className="libcal-date-browser-btn"
            onClick={() => handleLibCalBrowseDateChange(shiftDateKey(selectedDate, 1))}
            aria-label="Next day"
          >
            <span className="libcal-date-browser-next">{Icon.back}</span>
          </button>
          {selectedDate !== format(new Date(), "yyyy-MM-dd") ? (
            <button
              className="libcal-date-browser-today"
              onClick={() => handleLibCalBrowseDateChange(format(new Date(), "yyyy-MM-dd"))}
            >
              Today
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="libcal-date-browser-status">Loading study-room times...</div>
        ) : hasError ? (
          <div className="libcal-date-browser-status libcal-date-browser-status--error">
            {libcalRoomBrowserState.error}
          </div>
        ) : null}
      </div>
    );
  }

  function renderRetailDiningCard(formattedMenuDate) {
    const subvenues = effectiveSelectedDining?.subvenues || [];

    return (
      <>
        <div className="parking-selection-detail">
          <span className="parking-selection-label">Location</span>
          <p className="parking-selection-copy">
            {effectiveSelectedDining.description || 'Retail dining venue on campus.'}
          </p>
          {effectiveSelectedDining.paymentNote ? (
            <p className="parking-selection-copy parking-selection-copy--secondary">
              {effectiveSelectedDining.paymentNote}
            </p>
          ) : null}
        </div>

        <div className="parking-selection-detail dining-selection-menu">
          <span className="parking-selection-label">Shops for {formattedMenuDate}</span>
          <div className="retail-dining-list">
            {subvenues.length ? subvenues.map((subvenue) => {
              const subvenueStatus = getRetailSubvenueStatusInfo(effectiveSelectedDining, subvenue, diningReferenceDateTime);
              return (
                <div key={subvenue.id || subvenue.name} className="retail-dining-item">
                  <div className="retail-dining-item-main">
                    <div className="retail-dining-item-title">{subvenue.name}</div>
                    <div className="retail-dining-item-copy">{subvenue.hoursLabel || 'Closed'}</div>
                  </div>
                  <div className={`status-badge status-badge--${getDiningStatusClassName(subvenueStatus.status)}`}>
                    <span className="status-dot" />
                    {subvenueStatus.badgeLabel}
                  </div>
                </div>
              );
            }) : (
              <p className="parking-selection-copy parking-selection-copy--secondary">
                No posted hours for this date yet.
              </p>
            )}
          </div>
        </div>
      </>
    );
  }

  function renderDiningCard() {
    if (!effectiveSelectedDining || !selectedDiningStatus) return null;

    const isRetailVenue = isRetailDiningVenue(effectiveSelectedDining);
    const mealTabs = effectiveSelectedDining.meals || [];
    const formattedMenuDate = format(
      parseDateKey(effectiveSelectedDining.dateKey || diningBrowseDateKey || activeDateKey),
      "EEE, MMM d"
    );

    return (
      <div className="parking-selection-card dining-selection-card">
        {!focusedDiningMode && (
          <div className="parking-selection-top">
            <div>
              <div className="parking-selection-eyebrow">Dining</div>
              <div className="parking-selection-title">{effectiveSelectedDining.name}</div>
            </div>
            <button
              className="parking-selection-close"
              onClick={() => onClearDining && onClearDining()}
              aria-label="Close dining info"
            >
              {Icon.x}
            </button>
          </div>
        )}

        <div className="parking-selection-meta dining-selection-meta">
          <div className={`status-badge status-badge--${getDiningStatusClassName(selectedDiningStatus.status)}`}>
            <span className="status-dot" />
            {selectedDiningStatus.badgeLabel}
          </div>
          <div className="parking-selection-status-copy">
            {selectedDiningStatus.summary}
          </div>
        </div>

        <div className="dining-selection-actions">
          <button
            className="room-share-btn parking-selection-nav"
            onClick={() => {
              playSelectionHaptic();
              openExternalWalkingDirections(
                effectiveSelectedDining.latitude,
                effectiveSelectedDining.longitude
              );
            }}
          >
            {Icon.directions}
            <span>Navigate to Dining</span>
          </button>
          <button
            className="room-share-btn room-share-btn--secondary"
            onClick={() => openDiningMenuPage(effectiveSelectedDining)}
          >
            {isRetailVenue ? <span>View Hours Page</span> : <span>View Full Menu</span>}
          </button>
        </div>

        <div className="parking-selection-body">
          {!isRetailVenue && (
            <div className="libcal-date-browser">
              <div className="libcal-date-browser-top">
                <span className="parking-selection-label">Dining Date</span>
              </div>
              <div className="libcal-date-browser-controls">
                <button
                  className="libcal-date-browser-btn"
                  type="button"
                  onClick={() => handleDiningBrowseDay(-1)}
                  aria-label="View previous dining day"
                >
                  {Icon.back}
                </button>
                <label className="libcal-date-browser-chip">
                  {formattedMenuDate}
                  <input
                    type="date"
                    value={diningBrowseDateKey || ""}
                    onChange={(event) => handleDiningBrowseDateChange(event.target.value)}
                    aria-label="Choose dining date"
                  />
                </label>
                <button
                  className="libcal-date-browser-btn libcal-date-browser-next"
                  type="button"
                  onClick={() => handleDiningBrowseDay(1)}
                  aria-label="View next dining day"
                >
                  {Icon.back}
                </button>
                {diningBrowseDateKey !== activeDateKey && (
                  <button
                    className="libcal-date-browser-today"
                    type="button"
                    onClick={handleDiningBrowseToday}
                  >
                    Today
                  </button>
                )}
              </div>
              {diningBrowserState.status === "loading" ? (
                <div className="libcal-date-browser-status">Loading menu for {formattedMenuDate}...</div>
              ) : null}
              {diningBrowserState.status === "error" && diningBrowserState.error ? (
                <div className="libcal-date-browser-status libcal-date-browser-status--error">
                  {diningBrowserState.error}
                </div>
              ) : null}
            </div>
          )}

          {selectedDiningHoursLabel && !isRetailVenue && (
            <div className="parking-selection-detail">
              <span className="parking-selection-label">Hours</span>
              <p className="parking-selection-copy">{selectedDiningHoursLabel}</p>
            </div>
          )}

          {isRetailVenue ? renderRetailDiningCard(formattedMenuDate) : (
            <>
              {mealTabs.length > 0 && (
                <div className="parking-selection-detail">
                  <span className="parking-selection-label">Meals</span>
                  <div className="dining-meal-tabs">
                    {mealTabs.map((meal) => (
                      <button
                        key={meal.name}
                        className={`dining-meal-tab ${selectedDiningMeal?.name === meal.name ? "dining-meal-tab--active" : ""}`}
                        onClick={() => {
                          playSelectionHaptic();
                          setSelectedDiningMealName(meal.name);
                        }}
                      >
                        {meal.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedDiningMeal ? (
                <div className="parking-selection-detail dining-selection-menu">
                  <span className="parking-selection-label">{selectedDiningMeal.name} Menu</span>
                  <div className="dining-menu-sections">
                    {(selectedDiningMeal.sections || []).map((section) => (
                      <div key={section.name} className="dining-menu-section">
                        <div className="dining-menu-section-title">{section.name}</div>
                        <div className="dining-menu-items">
                          {(section.items || []).map((item) => (
                            <a
                              key={`${section.name}-${item.name}`}
                              className="dining-menu-item"
                              href={item.url || undefined}
                              target={item.url ? "_blank" : undefined}
                              rel={item.url ? "noopener noreferrer" : undefined}
                            >
                              {item.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="parking-selection-detail">
                  <span className="parking-selection-label">Menu</span>
                  <p className="parking-selection-copy parking-selection-copy--secondary">
                    No meal details are posted for this date yet.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  function renderAboutCard() {
    return (
      <div className="about-card">
        <div className="about-card-label">About Rooms</div>
        <div className="about-card-title">Find open spaces around UMD fast</div>
        <p className="about-card-copy">
          Rooms brings together classroom availability, bookable library study rooms,
          parking guidance, and dining hall status in one map.
        </p>
        <p className="about-card-copy about-card-copy--muted">
          Rooms is an independent student-built project and is not an official University of Maryland website or service. Always double-check posted room, parking, dining, and booking information if something looks off.
        </p>
        <div className="about-card-actions">
          <a
            className="about-card-link about-card-link--primary"
            href="https://github.com/andrewxie04/umdrooms"
            target="_blank"
            rel="noreferrer"
            onClick={() => playSelectionHaptic()}
          >
            GitHub Repo
          </a>
        </div>
      </div>
    );
  }

  function renderMapSettingsCard() {
    const layerOptions = [
      { key: "classrooms", label: "Classrooms", description: "General classroom availability dots" },
      { key: "studyRooms", label: "Study Rooms", description: "Bookable library study room markers" },
      { key: "parking", label: "Parking", description: "Parking lots and garages" },
      { key: "dining", label: "Dining", description: "Dining halls, markets, and shops" },
    ];

    return (
      <div className="about-card map-settings-card">
        <div className="about-card-label">Map Layers</div>
        <div className="about-card-title">Choose what appears on the map</div>
        <p className="about-card-copy">
          Turn layers on or off to keep the map focused on what you want to browse.
        </p>
        <div className="map-settings-list">
          {layerOptions.map((option) => {
            const active = Boolean(mapVisibility?.[option.key]);
            return (
              <button
                key={option.key}
                type="button"
                className={`map-settings-item ${active ? "map-settings-item--active" : ""}`}
                onClick={() => {
                  playToggleHaptic();
                  toggleMapLayer(option.key);
                }}
              >
                <div className="map-settings-item-copy">
                  <span className="map-settings-item-title">{option.label}</span>
                  <span className="map-settings-item-description">{option.description}</span>
                </div>
                <span className={`map-settings-switch ${active ? "map-settings-switch--active" : ""}`}>
                  <span className="map-settings-switch-knob" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const handleInfoButtonPress = useCallback(() => {
    playToggleHaptic();
    setShowAboutPanel((p) => !p);

    const now = Date.now();
    infoTapHistoryRef.current = [...infoTapHistoryRef.current.filter((time) => now - time < 900), now];
    if (infoTapHistoryRef.current.length >= 3) {
      infoTapHistoryRef.current = [];
      if (onInfoButtonTripleClick) {
        onInfoButtonTripleClick();
      }
    }
  }, [onInfoButtonTripleClick]);

  function renderLibCalBookingPanel(room) {
    const isActiveRoom = libcalBookingState.roomId === room.id;
    if (!isActiveRoom || libcalBookingState.status === "idle") return null;

    const startOptions = libcalBookingState.startOptions || [];
    const durationOptions = libcalBookingState.durationOptions || [];
    const fields = libcalBookingState.fields || [];
    const compactHoldMessage = compactLibCalHoldMessage(libcalBookingState.holdMessage);

    return (
      <div className="libcal-booking-card">
        <div className="libcal-booking-header">
          <div>
            <span className="room-info-label">Reserve In App</span>
            <h3 className="libcal-booking-title">{room.name}</h3>
          </div>
          <button
            className="libcal-booking-close"
            onClick={resetLibCalBookingState}
            aria-label="Close booking flow"
          >
            {Icon.x}
          </button>
        </div>

        {libcalBookingState.error ? (
          <div className="libcal-booking-error">{libcalBookingState.error}</div>
        ) : null}

        {(libcalBookingState.status === "loading-options" || libcalBookingState.status === "loading-form") ? (
          <div className="libcal-booking-loading">
            {libcalBookingState.status === "loading-options"
              ? "Checking LibCal booking options..."
              : "Loading the official booking form..."}
          </div>
        ) : null}

        {libcalBookingState.status === "options-ready" ? (
          <div className="libcal-booking-step">
            <label className="libcal-booking-field">
              <span className="libcal-booking-label">Start</span>
              <select
                className="ios-input"
                value={libcalBookingState.startDateTime}
                onChange={(e) => handleLibCalStartTimeChange(room, e.target.value)}
              >
                {startOptions.map((option) => (
                  <option key={option.start} value={option.start}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="libcal-booking-field">
              <span className="libcal-booking-label">Reserve Until</span>
              <select
                className="ios-input"
                value={libcalBookingState.endDateTime}
                onChange={(e) => handleLibCalDurationChange(e.target.value)}
              >
                {durationOptions.map((option) => (
                  <option key={option.end} value={option.end}>
                    {formatLibCalDateTime(option.end)}
                  </option>
                ))}
              </select>
            </label>
            <div className="libcal-booking-actions">
              <button
                className="room-share-btn"
                onClick={() => handleLoadLibCalBookingForm(room)}
              >
                <span>Continue</span>
              </button>
              <button
                className="room-share-btn room-share-btn--secondary"
                onClick={resetLibCalBookingState}
              >
                <span>Cancel</span>
              </button>
            </div>
          </div>
        ) : null}

        {["form-ready", "submitting", "success"].includes(libcalBookingState.status) ? (
          <div className="libcal-booking-step">
            {compactHoldMessage ? (
              <p className="libcal-booking-hold-badge">{compactHoldMessage}</p>
            ) : null}

            {libcalBookingState.summaryRows.length > 0 ? (
              <div className="libcal-booking-summary">
                {libcalBookingState.summaryRows.map((row, index) => (
                  <div key={`${row.item}-${index}`} className="libcal-booking-summary-row">
                    <span className="libcal-booking-summary-item">{row.item}</span>
                    <span className="libcal-booking-summary-copy">{row.from} - {row.to}</span>
                    <span className="libcal-booking-summary-copy libcal-booking-summary-copy--muted">{row.category}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {libcalBookingState.status === "success" ? (
              <div
                className="libcal-booking-success"
                dangerouslySetInnerHTML={{ __html: libcalBookingState.successHtml }}
              />
            ) : (
              <>
                {!libcalBookingState.showForm && libcalBookingState.termsHtml ? (
                  <div className="libcal-booking-terms">
                    <details className="libcal-booking-terms-disclosure">
                      <summary>View terms</summary>
                      <div
                        className="libcal-booking-terms-copy"
                        dangerouslySetInnerHTML={{ __html: libcalBookingState.termsHtml }}
                      />
                    </details>
                    <button className="room-share-btn" onClick={handleRevealLibCalBookingForm}>
                      <span>Open Form</span>
                    </button>
                  </div>
                ) : null}

                {libcalBookingState.showForm ? (
                  <div className="libcal-booking-form">
                    {fields.map((field) => (
                      <label key={field.name} className="libcal-booking-field">
                        <span className="libcal-booking-label">
                          {field.label}
                          {field.required ? " *" : ""}
                        </span>
                        {field.type === "select" ? (
                          <select
                            className="ios-input"
                            value={libcalBookingState.fieldValues[field.name] || ""}
                            onChange={(e) => handleLibCalFieldChange(field.name, e.target.value)}
                          >
                            {(field.options || []).map((option) => (
                              <option
                                key={`${field.name}-${option.value}-${option.label}`}
                                value={option.value}
                                disabled={option.disabled}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="ios-input"
                            type={field.type === "email" ? "email" : "text"}
                            placeholder={field.placeholder || ""}
                            value={libcalBookingState.fieldValues[field.name] || ""}
                            onChange={(e) => handleLibCalFieldChange(field.name, e.target.value)}
                          />
                        )}
                        {field.helpText ? (
                          <span className="libcal-booking-help">{field.helpText}</span>
                        ) : null}
                      </label>
                    ))}

                    <div className="libcal-booking-actions">
                      <button
                        className="room-share-btn"
                        onClick={() => handleSubmitLibCalBooking(room)}
                        disabled={libcalBookingState.status === "submitting"}
                      >
                        <span>
                          {libcalBookingState.status === "submitting"
                            ? "Submitting..."
                            : libcalBookingState.submitLabel}
                        </span>
                      </button>
                      <button
                        className="room-share-btn room-share-btn--secondary"
                        onClick={resetLibCalBookingState}
                        disabled={libcalBookingState.status === "submitting"}
                      >
                        <span>Cancel</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  /* ============================================
     RENDER
     ============================================ */

  const sidebarClasses = [
    "sidebar",
    isMobile ? "sidebar--sheet" : "sidebar--panel",
    darkMode ? "dark-mode" : "",
    focusedBuildingMode || focusedDiningMode ? "sidebar--focused" : "",
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
        <div className="sidebar-controls">
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
        ) : focusedDiningMode ? (
          <div className="sidebar-header sidebar-header--focused" ref={isMobile ? dragHeaderRef : undefined}>
            <button className="back-btn" onClick={handleExitDiningFocus}>
              {Icon.back}
              <span>Back</span>
            </button>
            <h1 className="header-title header-title--sm">
              {effectiveSelectedDining?.name || "Dining Hall"}
            </h1>
          </div>
        ) : (
          <div className="sidebar-header" ref={isMobile ? dragHeaderRef : undefined}>
            <h1 className="header-title">Rooms</h1>
            <div className="header-actions">
              <button
                className={`icon-btn ${showMapSettings ? "icon-btn--active" : ""}`}
                onClick={() => {
                  playToggleHaptic();
                  setShowMapSettings((p) => !p);
                }}
                aria-label={showMapSettings ? "Hide map layer settings" : "Show map layer settings"}
              >
                {Icon.layers}
              </button>
              <button
                className={`icon-btn ${showAboutPanel ? "icon-btn--active" : ""}`}
                onClick={handleInfoButtonPress}
                aria-label={showAboutPanel ? "Hide app info" : "Show app info"}
              >
                {Icon.info}
              </button>
              <button
                className={`icon-btn ${showFavorites ? "icon-btn--active" : ""}`}
                onClick={() => { playToggleHaptic(); setShowFavorites((p) => !p); }}
                aria-label={showFavorites ? "Show all" : "Show favorites"}
              >
                {showFavorites ? Icon.star : Icon.starOutline}
              </button>
              <button
                className="icon-btn"
                onClick={() => { playToggleHaptic(); toggleDarkMode(); }}
                aria-label={darkMode ? "Light mode" : "Dark mode"}
              >
                {darkMode ? Icon.sun : Icon.moon}
              </button>
            </div>
          </div>
        )}

        {!focusedBuildingMode && !focusedDiningMode && showMapSettings && renderMapSettingsCard()}
        {!focusedBuildingMode && !focusedDiningMode && showAboutPanel && renderAboutCard()}

        {/* Search bar */}
        {!focusedBuildingMode && !focusedDiningMode && (
          <div className="search-bar">
            <span className="search-bar-icon">{Icon.search}</span>
            <input
              ref={searchInputRef}
              type="text"
              className="search-bar-input"
              placeholder="Search buildings, rooms, or classes"
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
        {!focusedBuildingMode && !focusedDiningMode && (
          <div className="segmented-control">
            <div
              className="segment-slider"
              style={{
                transform:
                  viewMode === "now"
                    ? "translateX(0)"
                    : viewMode === "schedule"
                    ? "translateX(100%)"
                    : "translateX(200%)",
              }}
            />
            <button
              className={`segment ${viewMode === "now" ? "segment--active" : ""}`}
              onClick={() => handleModeChange("now")}
            >
              Now
            </button>
            <button
              className={`segment ${viewMode === "schedule" ? "segment--active" : ""}`}
              onClick={() => handleModeChange("schedule")}
            >
              Schedule
            </button>
            <button
              className={`segment ${viewMode === "all" ? "segment--active" : ""}`}
              onClick={() => handleModeChange("all")}
            >
              All Rooms
            </button>
          </div>
        )}

        {/* Duration filter chips (Now mode only) */}
        {viewMode === "now" && !focusedBuildingMode && !focusedDiningMode && (
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
                onClick={() => { playSelectionHaptic(); onDurationFilterChange(chip.value); }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Date browser / time pickers */}
        {!isNow && !focusedBuildingMode && !focusedDiningMode && (
          <div className="datetime-section">
            <div className="datetime-card">
              <span className="datetime-label">{viewMode === "schedule" ? "Start" : "Date"}</span>
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
            {viewMode === "schedule" && (
              <div className="datetime-card">
                <span className="datetime-label">End</span>
                <div className="datetime-inputs">
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
            )}
          </div>
        )}

        {(activeProgressState || hasAvailabilityError) && !focusedBuildingMode && !focusedDiningMode && (
          <div className={`availability-progress-card ${hasAvailabilityError ? "availability-progress-card--error" : ""}`}>
            <div className="availability-progress-row">
              <span className="availability-progress-title">
                {isInitialAvailabilityLoading
                  ? "Loading live room data"
                  : hasAvailabilityError
                  ? "Could not fetch that day"
                  : `Fetching ${activeDateLabel} schedules`}
              </span>
              {!hasAvailabilityError && (
                <span className="availability-progress-meta">
                  {activeProgressState?.indeterminate
                    ? "Working..."
                    : `${Math.round((activeProgressState?.progress || 0) * 100)}%`}
                </span>
              )}
            </div>
            {!hasAvailabilityError && (
              <div className="availability-progress-track" aria-hidden="true">
                <div
                  className={`availability-progress-fill ${activeProgressState?.indeterminate ? "availability-progress-fill--indeterminate" : ""}`}
                  style={
                    activeProgressState?.indeterminate
                      ? undefined
                      : { transform: `scaleX(${Math.max(0.04, activeProgressState?.progress || 0)})` }
                  }
                />
              </div>
            )}
            <p className="availability-progress-subtext">
              {hasAvailabilityError
                ? dayFetchState?.error || initialLoadState?.error || "Please try another date in a moment."
                : isInitialAvailabilityLoading
                ? "Downloading the latest room schedules for the app."
                : `Loaded ${dayFetchState?.completedRooms || 0} of ${dayFetchState?.totalRooms || 0} rooms across ${dayFetchState?.completedBuildings || 0} of ${dayFetchState?.totalBuildings || 0} buildings.`}
            </p>
          </div>
        )}

        {selectedDining && !focusedDiningMode && renderDiningCard()}

        {selectedParking && !focusedBuildingMode && (
          <div className="parking-selection-card">
            <div className="parking-selection-top">
              <div>
                <div className="parking-selection-eyebrow">Parking</div>
                <div className="parking-selection-title">{selectedParking.name}</div>
              </div>
              <button
                className="parking-selection-close"
                onClick={() => onClearParking && onClearParking()}
                aria-label="Close parking info"
              >
                {Icon.x}
              </button>
            </div>
            <button
              className="room-share-btn parking-selection-nav"
              onClick={() => {
                playSelectionHaptic();
                openExternalWalkingDirections(selectedParking.latitude, selectedParking.longitude);
              }}
            >
              {Icon.directions}
              <span>Navigate to Parking</span>
            </button>
            <div className="parking-selection-meta">
              <div className={`status-badge status-badge--${String(selectedParking.status || "").toLowerCase()}`}>
                <span className="status-dot" />
                {selectedParking.status === "Free"
                  ? "Available Now"
                  : selectedParking.status === "Visitor"
                  ? "Visitor Paid"
                  : "Unavailable Now"}
              </div>
              <div className="parking-selection-status-copy">
                {selectedParking.status === "Free"
                  ? "Free to park right now"
                  : selectedParking.status === "Visitor"
                  ? "Paid visitor parking"
                  : "Permit or restriction applies right now"}
              </div>
            </div>
            <div className="parking-selection-body">
              <div className="parking-selection-detail">
                <span className="parking-selection-label">Location</span>
                <p className="parking-selection-copy">{selectedParking.description}</p>
              </div>
              <div className="parking-selection-detail">
                <span className="parking-selection-label">Rules</span>
                <p className="parking-selection-copy parking-selection-copy--secondary">{selectedParking.detail}</p>
              </div>
            </div>
          </div>
        )}

        {/* Section header */}
        {!focusedBuildingMode &&
          !focusedDiningMode &&
          !shouldShowAvailabilityPlaceholder &&
          !(campusClosedInfo && !showFavorites && !searchQuery && filteredBuildings.length === 0) && (
          <div className="section-header">
            <span className="section-header-text">
              {showFavorites
                ? "Favorites"
                : searchQuery
                ? `${filteredBuildings.length} result${filteredBuildings.length !== 1 ? "s" : ""}`
                : showAllRooms
                ? `${filteredBuildings.length} buildings · all rooms`
                : `${filteredBuildings.length} buildings`}
            </span>
            <select
              className="sort-select"
              value={sortMode}
              onChange={(e) => { playSelectionHaptic(); setSortMode(e.target.value); }}
            >
              <option value="az">A–Z</option>
              <option value="available">Most Open</option>
              {userLocation && <option value="distance">Nearest</option>}
            </select>
          </div>
        )}
        </div>

        {/* Building list */}
        <div className="sidebar-results">
          {focusedDiningMode ? (
            renderDiningCard()
          ) : shouldShowAvailabilityPlaceholder ? (
            <div className={`availability-placeholder ${hasAvailabilityError ? "availability-placeholder--error" : ""}`}>
              <div className="availability-placeholder-icon">
                {hasAvailabilityError ? "!" : "..."}
              </div>
              <p className="availability-placeholder-title">
                {isInitialAvailabilityLoading
                  ? "Loading room schedules"
                  : hasAvailabilityError
                  ? "That date is not ready yet"
                  : `Fetching schedules for ${activeDateLabel}`}
              </p>
              <p className="availability-placeholder-subtext">
                {hasAvailabilityError
                  ? "We couldn't load that day's availability right now. Try the date again in a moment."
                  : "We'll fill in every building and room as soon as the fetch finishes."}
              </p>
            </div>
          ) : campusClosedInfo &&
            !focusedBuildingMode &&
            !focusedDiningMode &&
            !showFavorites &&
            !searchQuery &&
            filteredBuildings.length === 0 ? (
            <div className="closed-state">
              <div className="closed-state-emoji">🐢</div>
              <p className="closed-state-title">{campusClosedInfo.message}</p>
              <p className="closed-state-sub">
                Campus is closed {campusClosedInfo.isHoliday ? "for the holiday" : campusClosedInfo.isWeekend ? "for the weekend" : "for the night"}
              </p>
              <div className="closed-state-countdown">
                <span className="closed-state-timer">{campusClosedInfo.countdown}</span>
                <span className="closed-state-label">until doors open {campusClosedInfo.opensLabel}</span>
              </div>
              <p className="closed-state-hint">
                Switch to Schedule or All Rooms to keep browsing
              </p>
            </div>
          ) : renderedBuildings.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-text">
                {showFavorites &&
                favoriteBuildings.length === 0 &&
                favoriteRooms.length === 0
                  ? "No favorites yet. Tap the star on a building or room to save it."
                  : showAllRooms
                  ? "No rooms match the current search or filter."
                  : viewMode === "schedule"
                  ? "No rooms are open for that time range."
                  : durationFilter > 0
                  ? "No rooms stay open that long right now."
                  : "No rooms match the current filters."}
              </p>
            </div>
          ) : (
            <div className="list-group">
              {renderedBuildings.map((building) => {
              const isExpanded =
                expandedBuilding && expandedBuilding.code === building.code;
              const isSelected =
                selectedBuilding && selectedBuilding.code === building.code;

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
                      <span className="building-meta">{getBuildingMeta(building)}</span>
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
                              handleExternalDirections(building);
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
                          playToggleHaptic();
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
                      {getExpandedRoomsForBuilding(building).map((room) => {
                        const rawStatus = getClassroomAvailability(
                          room,
                          availabilityStartTime,
                          availabilityEndTime
                        );
                        const matchesDurationFilter = roomMeetsDurationFilter(room);
                        const status =
                          isNow && durationFilter > 0 && rawStatus === "Available" && !matchesDurationFilter
                            ? "Unavailable"
                            : rawStatus;
                        const libcalLaterInfo =
                          isNow && room.source === "libcal" && rawStatus === "Unavailable"
                            ? getLibCalNextAvailableInfo(room)
                            : null;
                        const openingSoonInfo =
                          isNow && rawStatus === "Opening Soon"
                            ? getOpeningSoonInfo(room)
                            : null;
                        const isSelectedRoom =
                          selectedClassroom && selectedClassroom.id === room.id;
                        const detailRoom =
                          isSelectedRoom && room.source === "libcal" && effectiveSelectedClassroom
                            ? effectiveSelectedClassroom
                            : room;
                        const displayStatus =
                          libcalLaterInfo && !openingSoonInfo ? "Bookable Later" : status;
                        const statusClass = displayStatus
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
                                    playToggleHaptic();
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
                                  {displayStatus}
                                  {isNow && status === "Available" && (() => {
                                    const until = getAvailableUntil(room);
                                    return until ? (
                                      <span className="available-until">until {until}</span>
                                    ) : null;
                                  })()}
                                  {openingSoonInfo ? (
                                    <span className="available-until">opens {openingSoonInfo.opensAt}</span>
                                  ) : libcalLaterInfo ? (
                                    <span className="available-until">starts {libcalLaterInfo.opensAt}</span>
                                  ) : null}
                                </span>
                              </div>
                            </div>

                            {/* Room detail card */}
                            {isSelectedRoom && (
                              <div className="room-detail">
                                <div className="room-detail-actions">
                                  <button
                                    className="room-share-btn"
                                    onClick={() => handleShareRoom(building, room)}
                                  >
                                    {Icon.share}
                                    <span>{viewMode === "schedule" ? "Share Room & Time" : "Share Room"}</span>
                                  </button>
                                  {room.source === "libcal" && room.libcal?.booking_url && (
                                    <button
                                      className="room-share-btn room-share-btn--secondary"
                                      onClick={() => openExternalBookingPage(detailRoom)}
                                    >
                                      {Icon.chevron}
                                      <span>Official Booking Page</span>
                                    </button>
                                  )}
                                </div>

                                {/* Room info */}
                                <div className="room-info-grid">
                                  <div className="room-info-item">
                                    <span className="room-info-label">Type</span>
                                    <span className="room-info-value">
                                      {detailRoom.type || "Classroom"}
                                    </span>
                                  </div>
                                  <div className="room-info-item">
                                    <span className="room-info-label">Floor</span>
                                    <span className="room-info-value">
                                      {detailRoom.floor ||
                                        (() => {
                                          const parts = detailRoom.name.split(" ");
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
                                    <span className="room-info-label">
                                      {room.source === "libcal" ? "Details" : "Features"}
                                    </span>
                                    <div className="feature-tags">
                                      {detailRoom.source === "libcal" ? (
                                        <>
                                          {detailRoom.capacity ? (
                                            <span className="feature-tag">Capacity {detailRoom.capacity}</span>
                                          ) : null}
                                          <span className="feature-tag">Reservable</span>
                                          <span className="feature-tag">LibCal</span>
                                        </>
                                      ) : (
                                        <>
                                          <span className="feature-tag">Projector</span>
                                          <span className="feature-tag">Whiteboard</span>
                                          {detailRoom.name.includes("C") && (
                                            <span className="feature-tag">Computers</span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {detailRoom.source === "libcal" ? renderLibCalDateBrowser() : null}

                                {detailRoom.source === "libcal" ? renderLibCalBookingPanel(detailRoom) : null}

                                {/* Timeline */}
                                <div className="timeline-section">
                                  {(() => {
                                    const isLibCalTimeline = detailRoom.source === "libcal";
                                    const timelineHours = isLibCalTimeline
                                      ? Array.from({ length: 24 }, (_, i) => i)
                                      : Array.from({ length: 15 }, (_, i) => i + 7);
                                    const timelineLabels = isLibCalTimeline
                                      ? [0, 6, 12, 18, 23]
                                      : [7, 12, 17, 22];
                                    const currentTimelineDate = isLibCalTimeline
                                      ? parseDateKey(libcalBrowseDateKey || activeDateKey)
                                      : isNow
                                      ? new Date()
                                      : selectedStartDateTime;
                                    const isTodayTimeline =
                                      format(currentTimelineDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

                                    return (
                                      <>
                                  <span className="timeline-title">
                                    {detailRoom.source === "libcal"
                                      ? isNow
                                        ? `Bookable Times for ${libcalBrowseDateLabel}`
                                        : `Bookable Times for ${libcalBrowseDateLabel}`
                                      : isNow
                                        ? "Today's Schedule"
                                        : `Schedule for ${format(selectedStartDateTime, "MMM d")}`}
                                  </span>
                                  <div className="timeline-bar">
                                    {timelineHours.map((hour) => {
                                      const isClosedDay =
                                        detailRoom.source !== "libcal" &&
                                        selectedClassroomStatus === "Closed";
                                      const isBooked = isClosedDay
                                        ? true
                                        : detailRoom.source === "libcal"
                                        ? !classroomSchedule.some((ev) => {
                                            return libCalHourFallsInBlock(hour, ev);
                                          })
                                        : classroomSchedule.some((ev) => {
                                            const s = Math.floor(parseFloat(ev.time_start));
                                            const e = Math.ceil(parseFloat(ev.time_end));
                                            return hour >= s && hour < e;
                                          });
                                      const currentHour = new Date().getHours();
                                      const isCurrent = isTodayTimeline && hour === currentHour;
                                      const segmentStatus = isClosedDay
                                        ? "Closed"
                                        : isBooked
                                        ? detailRoom.source === "libcal"
                                          ? "Unavailable"
                                          : "Booked"
                                        : "Available";

                                      return (
                                        <div
                                          key={hour}
                                          className={`tl-seg ${isBooked ? "tl-seg--booked" : "tl-seg--free"} ${isCurrent ? "tl-seg--now" : ""}`}
                                          title={`${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "pm" : "am"}: ${segmentStatus}`}
                                        />
                                      );
                                    })}
                                  </div>
                                  <div className="timeline-labels">
                                    {timelineLabels.map((hour) => (
                                      <span key={hour}>{formatHourTick(hour)}</span>
                                    ))}
                                  </div>
                                      </>
                                    );
                                  })()}
                                </div>

                                {/* Event list */}
                                <div className="event-list">
                                  <span className="event-list-title">
                                    {detailRoom.source === "libcal" ? "Available Blocks" : "Events"}
                                  </span>
                                  {classroomSchedule.length > 0 ? (
                                    classroomSchedule.map((ev, idx) => {
                                      const evStart = decimalToDate(
                                        detailRoom.source === "libcal"
                                          ? parseDateKey(libcalBrowseDateKey || activeDateKey)
                                          : isNow
                                          ? new Date()
                                          : selectedStartDateTime,
                                        ev.time_start
                                      );
                                      const evEnd = decimalToDate(
                                        detailRoom.source === "libcal"
                                          ? parseDateKey(libcalBrowseDateKey || activeDateKey)
                                          : isNow
                                          ? new Date()
                                          : selectedStartDateTime,
                                        ev.time_end
                                      );
                                      if (
                                        detailRoom.source === "libcal" &&
                                        parseFloat(ev.time_end) <= parseFloat(ev.time_start)
                                      ) {
                                        evEnd.setDate(evEnd.getDate() + 1);
                                      }
                                      const now = new Date();
                                      const isActive = now >= evStart && now <= evEnd;
                                      const isLibCalCurrentBlock =
                                        detailRoom.source === "libcal" && isActive;
                                      const names = detailRoom.source === "libcal"
                                        ? ["Available to reserve"]
                                        : parseEventNames(ev.event_name);
                                      const isExpanded = expandedEvents.has(`${selectedClassroom.id}-${idx}`);
                                      const visibleNames = isExpanded ? names : names.slice(0, 3);
                                      const overflow = Math.max(0, names.length - visibleNames.length);

                                      return (
                                        <div
                                          key={idx}
                                          className={`event-row ${
                                            isLibCalCurrentBlock
                                              ? "event-row--bookable-now"
                                              : isActive
                                              ? "event-row--active"
                                              : ""
                                          }`}
                                          onClick={() => {
                                            if (detailRoom.source !== "libcal" && (overflow > 0 || isExpanded)) {
                                              toggleEventExpansion(`${selectedClassroom.id}-${idx}`);
                                            }
                                          }}
                                        >
                                          <div className="event-row-main">
                                            <span className="event-time">
                                              {decimalToTimeString(ev.time_start)} –{" "}
                                              {decimalToTimeString(ev.time_end)}
                                            </span>
                                            <span className={`event-name ${!isExpanded ? "event-name--collapsed" : ""}`}>
                                              {visibleNames.join(", ")}
                                              {overflow > 0 && !isExpanded && (
                                                <span className="event-more"> +{overflow} more</span>
                                              )}
                                              {isExpanded && names.length > 3 && (
                                                <span className="event-more event-more--collapse"> Show less</span>
                                              )}
                                            </span>
                                          </div>
                                          {detailRoom.source === "libcal" ? (
                                            <button
                                              className="event-book-btn"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleStartLibCalBooking(detailRoom, ev);
                                              }}
                                            >
                                              Book
                                            </button>
                                          ) : null}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="event-empty">
                                      {detailRoom.source === "libcal"
                                        ? libcalRoomBrowserState.status === "loading"
                                          ? "Loading bookable times..."
                                          : "No bookable times on this date"
                                        : "No events scheduled"}
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
    </div>
  );
};

export default Sidebar;
