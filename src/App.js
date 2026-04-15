import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Sidebar from './Sidebar';
import CampusMap from './Map';
import './App.css';
import {
  fetchAvailabilityForDate,
  fetchJsonWithProgress,
  getCoverageRange,
  getDateKey,
  isDateCovered,
  stripAvailability,
} from './availabilityData';
import { fetchLibCalAvailabilityForDate, getLibCalBuildingInventory } from './libcalData';
import { fetchDiningHallsForDate } from './diningData';
import { boundedCacheSet } from './cache';
import { safeStorageGet, safeStorageSet } from './storage';

const EMPTY_DAY_FETCH_STATE = {
  status: 'idle',
  progress: 0,
  indeterminate: false,
  error: null,
  dateKey: null,
  completedRooms: 0,
  totalRooms: 0,
  completedBuildings: 0,
  totalBuildings: 0,
};

const TESTUDO_COUNT = 54;
function createTestudoSprites() {
  return Array.from({ length: TESTUDO_COUNT }, (_, index) => ({
    id: `${Date.now()}-${index}`,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.55}s`,
    duration: `${4.4 + Math.random() * 1.6}s`,
    size: `${46 + Math.random() * 28}px`,
    drift: `${(Math.random() - 0.5) * 120}px`,
    rotation: `${(Math.random() - 0.5) * 30}deg`,
    opacity: 0.5 + Math.random() * 0.25,
  }));
}

const App = () => {
  const [selectedStartDateTime, setSelectedStartDateTime] = useState(new Date());
  const [selectedEndDateTime, setSelectedEndDateTime] = useState(new Date());
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedParking, setSelectedParking] = useState(null);
  const [selectedDining, setSelectedDining] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [mapResetToken, setMapResetToken] = useState(0);
  const [mapSelectionMode, setMapSelectionMode] = useState(false);
  const [bundledBuildingsData, setBundledBuildingsData] = useState([]);
  const [buildingsData, setBuildingsData] = useState([]);
  const [mapBuildingsData, setMapBuildingsData] = useState([]);
  const [inventorySkeleton, setInventorySkeleton] = useState([]);
  const [bundledCoverage, setBundledCoverage] = useState(null);
  const [viewMode, setViewMode] = useState('now');
  const [availabilityReady, setAvailabilityReady] = useState(false);
  const [libraryBuildingsData, setLibraryBuildingsData] = useState([]);
  const [libraryInventory, setLibraryInventory] = useState(() => getLibCalBuildingInventory());
  const [diningHalls, setDiningHalls] = useState([]);
  const [initialLoadState, setInitialLoadState] = useState({
    status: 'loading',
    progress: 0,
    indeterminate: true,
    error: null,
  });
  const [dayFetchState, setDayFetchState] = useState(EMPTY_DAY_FETCH_STATE);
  const dayCacheRef = useRef(new Map());
  const libcalCacheRef = useRef(new Map());
  const diningCacheRef = useRef(new Map());
  const prefetchInFlightRef = useRef(new Set());
  const activeFetchIdRef = useRef(0);

  const [navigateTarget, setNavigateTarget] = useState(null);

  const [darkMode, setDarkMode] = useState(() => {
    const saved = safeStorageGet('darkMode');
    if (saved != null) {
      try { return JSON.parse(saved); } catch (e) { /* corrupted */ }
    }
    return true;
  });

  const [favoriteBuildings, setFavoriteBuildings] = useState(() => {
    const saved = safeStorageGet('favoriteBuildings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* corrupted */ }
    }
    return [];
  });

  const [favoriteRooms, setFavoriteRooms] = useState(() => {
    const saved = safeStorageGet('favoriteRooms');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* corrupted */ }
    }
    return [];
  });
  const [durationFilter, setDurationFilter] = useState(0);
  const [mapVisibility, setMapVisibility] = useState(() => {
    const saved = safeStorageGet('mapVisibility');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Failed to parse map visibility settings:', error);
      }
    }
    return {
      classrooms: true,
      studyRooms: true,
      parking: true,
      dining: true,
    };
  });
  const [testudoSprites, setTestudoSprites] = useState([]);

  const [userLocation, setUserLocation] = useState(null);
  const startRef = useRef(selectedStartDateTime);
  const testudoTimeoutRef = useRef(null);

  const [pendingBuildingCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('building') || null;
  });

  const [pendingRoom] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || null;
  });

  const sortBuildings = useCallback(
    (data) => data.slice().sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  const mergeBuildingCollections = useCallback(
    (baseBuildings, supplementalBuildings) => {
      const merged = new Map();

      for (const building of baseBuildings || []) {
        const key = building.code || building.name;
        merged.set(key, {
          ...building,
          classrooms: Array.isArray(building.classrooms) ? [...building.classrooms] : [],
        });
      }

      for (const building of supplementalBuildings || []) {
        const key = building.code || building.name;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, {
            ...building,
            classrooms: Array.isArray(building.classrooms) ? [...building.classrooms] : [],
          });
          continue;
        }

        const existingRoomIds = new Set((existing.classrooms || []).map((room) => String(room.id)));
        const nextRooms = [...(existing.classrooms || [])];

        for (const room of building.classrooms || []) {
          if (existingRoomIds.has(String(room.id))) continue;
          nextRooms.push(room);
        }

        merged.set(key, {
          ...existing,
          latitude: existing.latitude ?? building.latitude,
          longitude: existing.longitude ?? building.longitude,
          classrooms: nextRooms,
        });
      }

      return sortBuildings(Array.from(merged.values()));
    },
    [sortBuildings]
  );

  const activeDateKey = useMemo(
    () => getDateKey(viewMode === 'now' ? new Date() : selectedStartDateTime),
    [viewMode, selectedStartDateTime]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start');
    const end = params.get('end');
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (!isNaN(startDate) && !isNaN(endDate)) {
        setSelectedStartDateTime(startDate);
        setSelectedEndDateTime(endDate);
        setViewMode('schedule');
      }
    }
  }, []);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/buildings_metadata.json')
      .then((r) => {
        if (!r.ok) throw new Error('Network response was not ok');
        return r.json();
      })
      .then((data) => {
        setMapBuildingsData(sortBuildings(data));
      })
      .catch((err) => console.error('Error loading building metadata:', err));
  }, [sortBuildings]);

  useEffect(() => {
    const controller = new AbortController();
    setInitialLoadState({ status: 'loading', progress: 0, indeterminate: true, error: null });

    fetchJsonWithProgress(process.env.PUBLIC_URL + '/buildings_data.json', {
      signal: controller.signal,
      onProgress: ({ ratio, indeterminate }) => {
        setInitialLoadState((prev) => ({
          ...prev,
          status: 'loading',
          progress: ratio ?? prev.progress,
          indeterminate,
          error: null,
        }));
      },
    })
      .then((data) => {
        const sorted = sortBuildings(data);
        setBundledBuildingsData(sorted);
        setInventorySkeleton(stripAvailability(sorted));
        setBundledCoverage(getCoverageRange(sorted));
        setBuildingsData(sorted);
        setMapBuildingsData(sorted);
        setAvailabilityReady(true);
        setInitialLoadState({ status: 'ready', progress: 1, indeterminate: false, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Error loading building data:', err);
        setAvailabilityReady(false);
        setInitialLoadState({
          status: 'error',
          progress: 0,
          indeterminate: false,
          error: err.message || 'Failed to load room data.',
        });
      });

    return () => controller.abort();
  }, [sortBuildings]);

  useEffect(() => {
    if (!bundledBuildingsData.length) return;

    if (isDateCovered(activeDateKey, bundledCoverage)) {
      setBuildingsData(bundledBuildingsData);
      setMapBuildingsData(bundledBuildingsData);
      setAvailabilityReady(true);
      setDayFetchState(EMPTY_DAY_FETCH_STATE);
      return undefined;
    }

    const cachedData = dayCacheRef.current.get(activeDateKey);
    if (cachedData) {
      setBuildingsData(cachedData);
      setMapBuildingsData(cachedData);
      setAvailabilityReady(true);
      setDayFetchState({
        status: 'ready',
        progress: 1,
        indeterminate: false,
        error: null,
        dateKey: activeDateKey,
        completedRooms: cachedData.reduce((sum, building) => sum + (building.classrooms || []).length, 0),
        totalRooms: cachedData.reduce((sum, building) => sum + (building.classrooms || []).length, 0),
        completedBuildings: cachedData.length,
        totalBuildings: cachedData.length,
      });
      return undefined;
    }

    if (!inventorySkeleton.length) return undefined;

    const controller = new AbortController();
    const fetchId = activeFetchIdRef.current + 1;
    activeFetchIdRef.current = fetchId;

    setAvailabilityReady(false);
    setBuildingsData(inventorySkeleton);
    setMapBuildingsData(inventorySkeleton);
    setDayFetchState({
      status: 'loading',
      progress: 0,
      indeterminate: false,
      error: null,
      dateKey: activeDateKey,
      completedRooms: 0,
      totalRooms: inventorySkeleton.reduce((sum, building) => sum + (building.classrooms || []).length, 0),
      completedBuildings: 0,
      totalBuildings: inventorySkeleton.length,
    });

    fetchAvailabilityForDate(inventorySkeleton, activeDateKey, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (activeFetchIdRef.current !== fetchId) return;
        setDayFetchState({
          status: 'loading',
          progress: progress.ratio ?? 0,
          indeterminate: progress.indeterminate,
          error: null,
          dateKey: activeDateKey,
          completedRooms: progress.completedRooms,
          totalRooms: progress.totalRooms,
          completedBuildings: progress.completedBuildings,
          totalBuildings: progress.totalBuildings,
        });
      },
    })
      .then((data) => {
        if (activeFetchIdRef.current !== fetchId) return;
        const sorted = sortBuildings(data);
        boundedCacheSet(dayCacheRef.current, activeDateKey, sorted, 14);
        setBuildingsData(sorted);
        setMapBuildingsData(sorted);
        setAvailabilityReady(true);
        setDayFetchState({
          status: 'ready',
          progress: 1,
          indeterminate: false,
          error: null,
          dateKey: activeDateKey,
          completedRooms: sorted.reduce((sum, building) => sum + (building.classrooms || []).length, 0),
          totalRooms: sorted.reduce((sum, building) => sum + (building.classrooms || []).length, 0),
          completedBuildings: sorted.length,
          totalBuildings: sorted.length,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted || activeFetchIdRef.current !== fetchId) return;
        console.error(`Error fetching availability for ${activeDateKey}:`, err);
        setAvailabilityReady(false);
        setBuildingsData(inventorySkeleton);
        setMapBuildingsData(inventorySkeleton);
        setDayFetchState({
          status: 'error',
          progress: 0,
          indeterminate: false,
          error: err.message || 'Failed to fetch that day.',
          dateKey: activeDateKey,
          completedRooms: 0,
          totalRooms: inventorySkeleton.reduce((sum, building) => sum + (building.classrooms || []).length, 0),
          completedBuildings: 0,
          totalBuildings: inventorySkeleton.length,
        });
      });

    return () => controller.abort();
  }, [activeDateKey, bundledBuildingsData, bundledCoverage, inventorySkeleton, sortBuildings]);

  useEffect(() => {
    if (viewMode === 'now' || !inventorySkeleton.length || !bundledBuildingsData.length) return;

    const baseDate = new Date(`${activeDateKey}T12:00:00`);
    const adjacentDateKeys = [-1, 1].map((offset) => {
      const nextDate = new Date(baseDate);
      nextDate.setDate(baseDate.getDate() + offset);
      return getDateKey(nextDate);
    });

    adjacentDateKeys.forEach((dateKey) => {
      if (
        dateKey === activeDateKey ||
        isDateCovered(dateKey, bundledCoverage) ||
        dayCacheRef.current.has(dateKey) ||
        prefetchInFlightRef.current.has(dateKey)
      ) {
        return;
      }

      prefetchInFlightRef.current.add(dateKey);
      fetchAvailabilityForDate(inventorySkeleton, dateKey, { concurrency: 4 })
        .then((data) => {
          boundedCacheSet(dayCacheRef.current, dateKey, sortBuildings(data), 14);
        })
        .catch((err) => {
          console.error(`Error prefetching availability for ${dateKey}:`, err);
        })
        .finally(() => {
          prefetchInFlightRef.current.delete(dateKey);
        });
    });
  }, [activeDateKey, bundledBuildingsData.length, bundledCoverage, inventorySkeleton, sortBuildings, viewMode]);

  useEffect(() => {
    const cached = libcalCacheRef.current.get(activeDateKey);
    if (cached) {
      setLibraryBuildingsData(cached);
      setLibraryInventory(stripAvailability(cached));
      return undefined;
    }

    const controller = new AbortController();
    setLibraryBuildingsData([]);

    fetchLibCalAvailabilityForDate(activeDateKey, { signal: controller.signal })
      .then((data) => {
        boundedCacheSet(libcalCacheRef.current, activeDateKey, data, 14);
        setLibraryBuildingsData(data);
        setLibraryInventory(stripAvailability(data));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(`Error loading LibCal availability for ${activeDateKey}:`, err);
        setLibraryBuildingsData([]);
      });

    return () => controller.abort();
  }, [activeDateKey, libraryInventory.length]);

  useEffect(() => {
    const cached = diningCacheRef.current.get(activeDateKey);
    if (cached) {
      setDiningHalls(cached);
      return undefined;
    }

    const controller = new AbortController();
    setDiningHalls([]);

    fetchDiningHallsForDate(activeDateKey, { signal: controller.signal })
      .then((data) => {
        boundedCacheSet(diningCacheRef.current, activeDateKey, data, 14);
        setDiningHalls(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(`Error loading dining information for ${activeDateKey}:`, err);
        setDiningHalls([]);
      });

    return () => controller.abort();
  }, [activeDateKey]);

  const handleBuildingSelect = useCallback((building, fromMap = false) => {
    setSelectedParking(null);
    setSelectedDining(null);
    setSelectedRoomId(null);
    setSelectedBuilding(building);
    setMapSelectionMode(fromMap);
  }, []);

  const handleRoomSelect = useCallback((building, room, fromMap = false) => {
    setSelectedParking(null);
    setSelectedDining(null);
    setSelectedBuilding(building);
    setSelectedRoomId(room?.id ?? null);
    setMapSelectionMode(fromMap);
  }, []);

  const handleParkingSelect = useCallback((parking) => {
    setSelectedBuilding(null);
    setSelectedRoomId(null);
    setSelectedDining(null);
    setMapSelectionMode(false);
    setSelectedParking(parking);
  }, []);

  const handleDiningSelect = useCallback((hall) => {
    setSelectedBuilding(null);
    setSelectedRoomId(null);
    setSelectedParking(null);
    setMapSelectionMode(false);
    setSelectedDining(hall);
  }, []);

  const handleExitBuildingFocus = useCallback(() => {
    setMapResetToken((prev) => prev + 1);
  }, []);

  const handleClearDining = useCallback(() => {
    setSelectedDining(null);
    setMapResetToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!selectedDining) return;
    const nextDining = (diningHalls || []).find((hall) => hall.id === selectedDining.id);
    if (nextDining) {
      setSelectedDining(nextDining);
      return;
    }
    setSelectedDining(null);
  }, [diningHalls, selectedDining]);

  useEffect(() => {
    startRef.current = selectedStartDateTime;
  }, [selectedStartDateTime]);

  const handleStartDateTimeChange = useCallback((update) => {
    setSelectedStartDateTime((prev) => {
      const newDT = typeof update === 'function' ? update(prev) : update;
      if (!(newDT instanceof Date) || isNaN(newDT)) return prev;
      setSelectedEndDateTime((prevEnd) => {
        const synced = new Date(prevEnd);
        synced.setFullYear(newDT.getFullYear(), newDT.getMonth(), newDT.getDate());
        if (synced <= newDT) return new Date(newDT.getTime());
        return synced;
      });
      return newDT;
    });
  }, []);

  const handleEndDateTimeChange = useCallback((update) => {
    setSelectedEndDateTime((prev) => {
      const newDT = typeof update === 'function' ? update(prev) : update;
      if (!(newDT instanceof Date) || isNaN(newDT)) return prev;
      const s = startRef.current;
      const clamped = new Date(newDT);
      clamped.setFullYear(s.getFullYear(), s.getMonth(), s.getDate());
      if (clamped <= s) return new Date(s.getTime());
      return clamped;
    });
  }, []);

  useEffect(() => {
    if (viewMode !== 'now') return;
    const id = setInterval(() => {
      const now = new Date();
      setSelectedStartDateTime(now);
      setSelectedEndDateTime(now);
    }, 60000);
    return () => clearInterval(id);
  }, [viewMode]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    document.documentElement.classList.toggle('dark-mode', darkMode);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', darkMode ? '#1C1C1E' : '#F2F2F7');
    }
  }, [darkMode]);


  useEffect(() => {
    safeStorageSet('favoriteBuildings', JSON.stringify(favoriteBuildings));
  }, [favoriteBuildings]);

  useEffect(() => {
    safeStorageSet('favoriteRooms', JSON.stringify(favoriteRooms));
  }, [favoriteRooms]);

  useEffect(() => {
    safeStorageSet('mapVisibility', JSON.stringify(mapVisibility));
  }, [mapVisibility]);

  const toggleDarkMode = useCallback(
    () =>
      setDarkMode((p) => {
        const next = !p;
        safeStorageSet('darkMode', JSON.stringify(next));
        return next;
      }),
    []
  );

  const toggleFavoriteBuilding = useCallback((building) => {
    setFavoriteBuildings((prev) => {
      const exists = prev.some((f) => f.code === building.code);
      return exists
        ? prev.filter((f) => f.code !== building.code)
        : [...prev, { code: building.code, name: building.name }];
    });
  }, []);

  const toggleFavoriteRoom = useCallback((building, room) => {
    setFavoriteRooms((prev) => {
      const exists = prev.some((f) => f.id === room.id);
      return exists
        ? prev.filter((f) => f.id !== room.id)
        : [
            ...prev,
            {
              id: room.id,
              name: room.name,
              buildingCode: building.code,
              buildingName: building.name,
            },
          ];
    });
  }, []);

  const toggleMapLayer = useCallback((layerKey) => {
    setMapVisibility((prev) => ({
      ...prev,
      [layerKey]: !prev[layerKey],
    }));
  }, []);

  const triggerTestudoStorm = useCallback(() => {
    setTestudoSprites(createTestudoSprites());
    if (testudoTimeoutRef.current) {
      clearTimeout(testudoTimeoutRef.current);
    }
    testudoTimeoutRef.current = setTimeout(() => {
      setTestudoSprites([]);
      testudoTimeoutRef.current = null;
    }, 5200);
  }, []);

  const combinedBuildingsData = useMemo(
    () => mergeBuildingCollections(buildingsData, libraryBuildingsData),
    [buildingsData, libraryBuildingsData, mergeBuildingCollections]
  );

  const combinedMapBuildingsData = useMemo(
    () =>
      mergeBuildingCollections(
        buildingsData.length > 0 ? buildingsData : mapBuildingsData,
        libraryBuildingsData.length > 0 ? libraryBuildingsData : libraryInventory
      ),
    [buildingsData, mapBuildingsData, libraryBuildingsData, libraryInventory, mergeBuildingCollections]
  );

  useEffect(() => () => {
    if (testudoTimeoutRef.current) {
      clearTimeout(testudoTimeoutRef.current);
    }
  }, []);

  return (
    <div className={`app-container ${darkMode ? 'dark-mode' : ''}`}>
      <Sidebar
        buildingsData={combinedBuildingsData}
        onBuildingSelect={handleBuildingSelect}
        selectedBuilding={selectedBuilding}
        selectedParking={selectedParking}
        selectedDining={selectedDining}
        selectedRoomId={selectedRoomId}
        onClearParking={() => setSelectedParking(null)}
        onClearDining={handleClearDining}
        selectedStartDateTime={selectedStartDateTime}
        selectedEndDateTime={selectedEndDateTime}
        onStartDateTimeChange={handleStartDateTimeChange}
        onEndDateTimeChange={handleEndDateTimeChange}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        favoriteBuildings={favoriteBuildings}
        favoriteRooms={favoriteRooms}
        toggleFavoriteBuilding={toggleFavoriteBuilding}
        toggleFavoriteRoom={toggleFavoriteRoom}
        durationFilter={durationFilter}
        onDurationFilterChange={setDurationFilter}
        mapVisibility={mapVisibility}
        toggleMapLayer={toggleMapLayer}
        onInfoButtonTripleClick={triggerTestudoStorm}
        mapSelectionMode={mapSelectionMode}
        onNavigateToBuilding={setNavigateTarget}
        userLocation={userLocation}
        pendingBuildingCode={pendingBuildingCode}
        pendingRoom={pendingRoom}
        viewMode={viewMode}
        onModeChange={setViewMode}
        availabilityReady={availabilityReady}
        initialLoadState={initialLoadState}
        dayFetchState={dayFetchState}
        activeDateKey={activeDateKey}
        onExitBuildingFocus={handleExitBuildingFocus}
      />
      <div className="map-container">
        <CampusMap
          buildingsData={combinedMapBuildingsData}
          liveDataReady={availabilityReady}
          selectedBuilding={selectedBuilding}
          selectedRoomId={selectedRoomId}
          onBuildingSelect={handleBuildingSelect}
          onRoomSelect={handleRoomSelect}
          onParkingSelect={handleParkingSelect}
          diningHalls={diningHalls}
          selectedDining={selectedDining}
          onDiningSelect={handleDiningSelect}
          selectedStartDateTime={selectedStartDateTime}
          selectedEndDateTime={selectedEndDateTime}
          viewMode={viewMode}
          darkMode={darkMode}
          navigateTarget={navigateTarget}
          onNavigateComplete={() => setNavigateTarget(null)}
          userLocation={userLocation}
          mapResetToken={mapResetToken}
          mapVisibility={mapVisibility}
          durationFilter={durationFilter}
        />
      </div>
      {testudoSprites.length > 0 ? (
        <div className="testudo-storm" aria-hidden="true">
          {testudoSprites.map((sprite) => (
            <img
              key={sprite.id}
              className="testudo-storm-sprite"
              src={`${process.env.PUBLIC_URL || ''}/testudo-easter-egg.jpg`}
              alt=""
              style={{
                left: sprite.left,
                width: sprite.size,
                height: sprite.size,
                animationDelay: sprite.delay,
                animationDuration: sprite.duration,
                '--testudo-drift': sprite.drift,
                '--testudo-rotation': sprite.rotation,
                '--testudo-opacity': sprite.opacity,
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default App;
