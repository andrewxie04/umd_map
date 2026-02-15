import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import Map from './Map';
import './App.css';

const App = () => {
  const [selectedStartDateTime, setSelectedStartDateTime] = useState(new Date());
  const [selectedEndDateTime, setSelectedEndDateTime] = useState(new Date());
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [mapSelectionMode, setMapSelectionMode] = useState(false);
  const [buildingsData, setBuildingsData] = useState([]);

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

  const [isNow, setIsNow] = useState(true);
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

  // If URL has start/end params, initialize into schedule mode
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
        setIsNow(false);
      }
    }
  }, []);

  // Load building data once
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + "/buildings_data.json")
      .then((r) => {
        if (!r.ok) throw new Error("Network response was not ok");
        return r.json();
      })
      .then((data) => {
        const sorted = data.slice().sort((a, b) => a.name.localeCompare(b.name));
        setBuildingsData(sorted);
      })
      .catch((err) => console.error("Error loading building data:", err));
  }, []);

  const handleBuildingSelect = useCallback((building, fromMap = false) => {
    setSelectedBuilding(building);
    setMapSelectionMode(fromMap);
  }, []);

  useEffect(() => { startRef.current = selectedStartDateTime; }, [selectedStartDateTime]);

  const handleStartDateTimeChange = useCallback((update) => {
    setSelectedStartDateTime((prev) => {
      const newDT = typeof update === 'function' ? update(prev) : update;
      if (!(newDT instanceof Date) || isNaN(newDT)) return prev;
      // Sync end date to match start date, keep end time
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
      // Enforce same day as start and end >= start
      const s = startRef.current;
      const clamped = new Date(newDT);
      clamped.setFullYear(s.getFullYear(), s.getMonth(), s.getDate());
      if (clamped <= s) return new Date(s.getTime());
      return clamped;
    });
  }, []);

  // Refresh map availability every 60s in Now mode
  useEffect(() => {
    if (!isNow) return;
    const id = setInterval(() => {
      const now = new Date();
      setSelectedStartDateTime(now);
      setSelectedEndDateTime(now);
    }, 60000);
    return () => clearInterval(id);
  }, [isNow]);

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

  // If user hasn't explicitly toggled dark mode, follow system changes.
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
        // Persist only when user explicitly toggles (otherwise default follows system).
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
        : [...prev, { id: room.id, name: room.name, buildingCode: building.code, buildingName: building.name }];
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
        isNow={isNow}
        onModeChange={setIsNow}
      />
      <div className="map-container">
        <Map
          buildingsData={buildingsData}
          selectedBuilding={selectedBuilding}
          onBuildingSelect={handleBuildingSelect}
          selectedStartDateTime={selectedStartDateTime}
          selectedEndDateTime={selectedEndDateTime}
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
