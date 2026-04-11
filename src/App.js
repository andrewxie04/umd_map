import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Sidebar from './Sidebar';
import Map from './Map';
import './App.css';
import {
  fetchAvailabilityForDate,
  fetchJsonWithProgress,
  getCoverageRange,
  getDateKey,
  isDateCovered,
  stripAvailability,
} from './availabilityData';

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

const App = () => {
  const [selectedStartDateTime, setSelectedStartDateTime] = useState(new Date());
  const [selectedEndDateTime, setSelectedEndDateTime] = useState(new Date());
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [mapSelectionMode, setMapSelectionMode] = useState(false);
  const [bundledBuildingsData, setBundledBuildingsData] = useState([]);
  const [buildingsData, setBuildingsData] = useState([]);
  const [mapBuildingsData, setMapBuildingsData] = useState([]);
  const [inventorySkeleton, setInventorySkeleton] = useState([]);
  const [bundledCoverage, setBundledCoverage] = useState(null);
  const [viewMode, setViewMode] = useState('now');
  const [availabilityReady, setAvailabilityReady] = useState(false);
  const [initialLoadState, setInitialLoadState] = useState({
    status: 'loading',
    progress: 0,
    indeterminate: true,
    error: null,
  });
  const [dayFetchState, setDayFetchState] = useState(EMPTY_DAY_FETCH_STATE);
  const dayCacheRef = useRef(new Map());
  const activeFetchIdRef = useRef(0);

  const [navigateTarget, setNavigateTarget] = useState(null);

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved != null) return JSON.parse(saved);
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [favoriteBuildings, setFavoriteBuildings] = useState(() => {
    const saved = localStorage.getItem('favoriteBuildings');
    return saved ? JSON.parse(saved) : [];
  });

  const [favoriteRooms, setFavoriteRooms] = useState(() => {
    const saved = localStorage.getItem('favoriteRooms');
    return saved ? JSON.parse(saved) : [];
  });

  const [userLocation, setUserLocation] = useState(null);
  const startRef = useRef(selectedStartDateTime);

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
        dayCacheRef.current.set(activeDateKey, sorted);
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

  const handleBuildingSelect = useCallback((building, fromMap = false) => {
    setSelectedBuilding(building);
    setMapSelectionMode(fromMap);
  }, []);

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
      themeMeta.setAttribute('content', darkMode ? '#000000' : '#F2F2F7');
    }
  }, [darkMode]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (localStorage.getItem('darkMode') != null) return;
      setDarkMode(e.matches);
    };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('favoriteBuildings', JSON.stringify(favoriteBuildings));
  }, [favoriteBuildings]);

  useEffect(() => {
    localStorage.setItem('favoriteRooms', JSON.stringify(favoriteRooms));
  }, [favoriteRooms]);

  const toggleDarkMode = useCallback(
    () =>
      setDarkMode((p) => {
        const next = !p;
        localStorage.setItem('darkMode', JSON.stringify(next));
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

  return (
    <div className={`app-container ${darkMode ? 'dark-mode' : ''}`}>
      <Sidebar
        buildingsData={buildingsData}
        onBuildingSelect={handleBuildingSelect}
        selectedBuilding={selectedBuilding}
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
      />
      <div className="map-container">
        <Map
          buildingsData={buildingsData.length > 0 ? buildingsData : mapBuildingsData}
          liveDataReady={availabilityReady}
          selectedBuilding={selectedBuilding}
          onBuildingSelect={handleBuildingSelect}
          selectedStartDateTime={selectedStartDateTime}
          selectedEndDateTime={selectedEndDateTime}
          viewMode={viewMode}
          darkMode={darkMode}
          navigateTarget={navigateTarget}
          onNavigateComplete={() => setNavigateTarget(null)}
          userLocation={userLocation}
        />
      </div>
    </div>
  );
};

export default App;
