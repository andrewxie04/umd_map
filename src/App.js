import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import Map from './Map';
import './App.css';

const App = () => {
  const [selectedStartDateTime, setSelectedStartDateTime] = useState(new Date());
  const [selectedEndDateTime, setSelectedEndDateTime] = useState(new Date());
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [mapSelectionMode, setMapSelectionMode] = useState(false);

  const [navigateTarget, setNavigateTarget] = useState(null);

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });

  const [favoriteBuildings, setFavoriteBuildings] = useState(() => {
    const saved = localStorage.getItem('favoriteBuildings');
    return saved ? JSON.parse(saved) : [];
  });

  const [favoriteRooms, setFavoriteRooms] = useState(() => {
    const saved = localStorage.getItem('favoriteRooms');
    return saved ? JSON.parse(saved) : [];
  });

  const handleBuildingSelect = useCallback((building, fromMap = false) => {
    setSelectedBuilding(building);
    setMapSelectionMode(fromMap);
  }, []);

  const handleStartDateTimeChange = useCallback((update) => {
    setSelectedStartDateTime((prev) => {
      const newDT = typeof update === 'function' ? update(prev) : update;
      if (!(newDT instanceof Date) || isNaN(newDT)) return prev;
      setSelectedEndDateTime((prevEnd) => (prevEnd <= newDT ? new Date(newDT.getTime()) : prevEnd));
      return newDT;
    });
  }, []);

  const handleEndDateTimeChange = useCallback((update) => {
    setSelectedEndDateTime((prev) => {
      const newDT = typeof update === 'function' ? update(prev) : update;
      if (!(newDT instanceof Date) || isNaN(newDT)) return prev;
      return newDT;
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('favoriteBuildings', JSON.stringify(favoriteBuildings));
  }, [favoriteBuildings]);

  useEffect(() => {
    localStorage.setItem('favoriteRooms', JSON.stringify(favoriteRooms));
  }, [favoriteRooms]);

  const toggleDarkMode = useCallback(() => setDarkMode((p) => !p), []);

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
      />
      <div className="map-container">
        <Map
          selectedBuilding={selectedBuilding}
          onBuildingSelect={handleBuildingSelect}
          selectedStartDateTime={selectedStartDateTime}
          selectedEndDateTime={selectedEndDateTime}
          darkMode={darkMode}
          navigateTarget={navigateTarget}
          onNavigateComplete={() => setNavigateTarget(null)}
        />
      </div>
    </div>
  );
};

export default App;
