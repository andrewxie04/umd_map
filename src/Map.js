import React, { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "./Map.css";
import { getBuildingAvailability } from "./availability";
import { addMapLegend } from "./legend";

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;

const MAP_STYLE = "mapbox://styles/remagi/cm31ucjm700q901qke5264xrp";
const DOT_COLORS = {
  available: "#4CFF88",
  unavailable: "#FF4B57",
  loadingA: "#4FD8FF",
  loadingB: "#A6EEFF",
  muted: "#8E8E93",
};

// Haversine distance in meters between two [lng, lat] points
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

const Map = ({
  buildingsData,
  liveDataReady,
  selectedBuilding,
  onBuildingSelect,
  selectedStartDateTime,
  selectedEndDateTime,
  viewMode,
  darkMode,
  navigateTarget,
  onNavigateComplete,
  userLocation,
}) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const buildingsDataRef = useRef([]);
  const isMapLoadedRef = useRef(false);
  const routeStateRef = useRef({ active: false });
  const buildingLayerEventsBoundRef = useRef(false);
  const loadingPulseRef = useRef(null);
  const loadingAnimationFrameRef = useRef(null);

  const [navigating, setNavigating] = useState(false); // loading spinner
  const [routeInfo, setRouteInfo] = useState(null); // { distance, duration, buildingName }
  const [mapLoaded, setMapLoaded] = useState(false);
  const isScheduleMode = viewMode === "schedule";
  const availabilityStart = isScheduleMode ? selectedStartDateTime : null;
  const availabilityEnd = isScheduleMode ? selectedEndDateTime : null;

  const getDotColorExpression = useCallback(() => ([
    "case",
    ["get", "selected"],
    "#FFFFFF",
    [
      "match",
      ["get", "availabilityStatus"],
      "Available", DOT_COLORS.available,
      "Unavailable", DOT_COLORS.unavailable,
      "Loading", DOT_COLORS.loadingA,
      "No Data", DOT_COLORS.muted,
      "Closed", DOT_COLORS.muted,
      DOT_COLORS.muted,
    ],
  ]), []);

  const applyDotLayerStyles = useCallback((map) => {
    const colorExpr = getDotColorExpression();

    if (map.getLayer("building-dots-glow")) {
      map.setPaintProperty("building-dots-glow", "circle-color", colorExpr);
      map.setPaintProperty("building-dots-glow", "circle-radius", liveDataReady ? 11.5 : 9.8);
      map.setPaintProperty("building-dots-glow", "circle-opacity", liveDataReady ? 0.82 : 0.38);
      map.setPaintProperty("building-dots-glow", "circle-blur", 1.08);
      map.setPaintProperty("building-dots-glow", "circle-emissive-strength", 1);
    }

    if (map.getLayer("building-dots")) {
      map.setPaintProperty("building-dots", "circle-color", colorExpr);
      map.setPaintProperty("building-dots", "circle-radius", liveDataReady ? 4.9 : 4.5);
      map.setPaintProperty("building-dots", "circle-stroke-width", 1.1);
      map.setPaintProperty(
        "building-dots",
        "circle-stroke-color",
        "rgba(255,255,255,0.32)"
      );
      map.setPaintProperty("building-dots", "circle-opacity", 1);
      map.setPaintProperty("building-dots", "circle-emissive-strength", 1);
    }

    map.triggerRepaint();
  }, [darkMode, getDotColorExpression, liveDataReady]);

  const updateMapData = useCallback((map, data, start, end, selected) => {
    const features = data.map((building, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [building.longitude, building.latitude] },
      properties: {
        id: i,
        name: building.name,
        code: building.code,
        availabilityStatus: liveDataReady
          ? getBuildingAvailability(building.classrooms, start, end)
          : "Loading",
        selected: selected && building.code === selected.code ? true : false,
      },
    }));

    const geojson = { type: "FeatureCollection", features };

    if (map.getSource("buildings")) {
      map.getSource("buildings").setData(geojson);
      applyDotLayerStyles(map);
    } else {
      map.addSource("buildings", { type: "geojson", data: geojson });

      map.addLayer({
        id: "building-dots-glow",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": liveDataReady ? 11.5 : 9.8,
          "circle-color": getDotColorExpression(),
          "circle-opacity": liveDataReady ? 0.82 : 0.38,
          "circle-blur": 1.08,
          "circle-emissive-strength": 1,
        },
      });

      map.addLayer({
        id: "building-dots",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": liveDataReady ? 4.9 : 4.5,
          "circle-color": getDotColorExpression(),
          "circle-stroke-width": 1.1,
          "circle-stroke-color": "rgba(255,255,255,0.32)",
          "circle-opacity": 1,
          "circle-emissive-strength": 1,
        },
      });

      applyDotLayerStyles(map);
    }
  }, [applyDotLayerStyles, darkMode, getDotColorExpression, liveDataReady]);

  // Clear route from the map
  const clearRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    ["route-line", "route-line-outline", "user-location-glow", "user-location-dot"].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    ["route", "user-location"].forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });

    routeStateRef.current = { active: false };
    setRouteInfo(null);
  }, []);

  // Core routing: get user location, draw route to a given building
  const routeToBuilding = useCallback((target) => {
    const map = mapRef.current;
    if (!map) return;

    clearRoute();
    setNavigating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;

        // Add user location marker
        if (map.getSource("user-location")) {
          map.getSource("user-location").setData({
            type: "Point",
            coordinates: [userLng, userLat],
          });
        } else {
          map.addSource("user-location", {
            type: "geojson",
            data: { type: "Point", coordinates: [userLng, userLat] },
          });

          map.addLayer({
            id: "user-location-glow",
            type: "circle",
            source: "user-location",
            paint: {
              "circle-radius": 18,
              "circle-color": "#007AFF",
              "circle-opacity": 0.2,
              "circle-blur": 0.8,
            },
          });

          map.addLayer({
            id: "user-location-dot",
            type: "circle",
            source: "user-location",
            paint: {
              "circle-radius": 7,
              "circle-color": "#007AFF",
              "circle-stroke-width": 2.5,
              "circle-stroke-color": "#FFFFFF",
              "circle-opacity": 1,
            },
          });
        }

        // Fetch walking route from Mapbox Directions API
        const token = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;
        const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${userLng},${userLat};${target.longitude},${target.latitude}?geometries=geojson&access_token=${token}`;

        fetch(url)
          .then((r) => r.json())
          .then((resp) => {
            if (!resp.routes || resp.routes.length === 0) {
              setNavigating(false);
              alert("Could not find a walking route.");
              return;
            }

            const route = resp.routes[0];
            const routeGeometry = route.geometry;
            const distanceMeters = route.distance;
            const durationSeconds = route.duration;

            // Draw route on map
            if (map.getSource("route")) {
              map.getSource("route").setData(routeGeometry);
            } else {
              map.addSource("route", { type: "geojson", data: routeGeometry });

              map.addLayer(
                {
                  id: "route-line-outline",
                  type: "line",
                  source: "route",
                  layout: { "line-join": "round", "line-cap": "round" },
                  paint: {
                    "line-color": darkMode ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.8)",
                    "line-width": 8,
                  },
                },
                "building-dots-glow"
              );

              map.addLayer(
                {
                  id: "route-line",
                  type: "line",
                  source: "route",
                  layout: { "line-join": "round", "line-cap": "round" },
                  paint: {
                    "line-color": "#007AFF",
                    "line-width": 4,
                  },
                },
                "building-dots-glow"
              );
            }

            // Fit map to show both user and destination
            const coords = routeGeometry.coordinates;
            const bounds = coords.reduce(
              (b, c) => b.extend(c),
              new mapboxgl.LngLatBounds(coords[0], coords[0])
            );
            map.fitBounds(bounds, { padding: 80, duration: 1500 });

            const distanceMi = (distanceMeters / 1609.34).toFixed(1);
            const durationMin = Math.round(durationSeconds / 60);

            routeStateRef.current = { active: true, userLng, userLat, targetBuilding: target };
            setRouteInfo({
              distance: `${distanceMi} mi`,
              duration: `${durationMin} min`,
              buildingName: target.name,
            });
            setNavigating(false);
          })
          .catch((err) => {
            console.error("Route fetch error:", err);
            setNavigating(false);
            alert("Failed to fetch walking route.");
          });
      },
      (err) => {
        setNavigating(false);
        if (err.code === err.PERMISSION_DENIED) {
          alert("Location access denied. Please enable location permissions to use navigation.");
        } else {
          alert("Could not get your location. Please try again.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [clearRoute, darkMode]);

  useEffect(() => {
    buildingsDataRef.current = Array.isArray(buildingsData) ? buildingsData : [];
  }, [buildingsData]);

  const ensureBuildingLayerEvents = useCallback(() => {
    const map = mapRef.current;
    if (!map || buildingLayerEventsBoundRef.current) return;
    if (!map.getLayer("building-dots")) return;

    buildingLayerEventsBoundRef.current = true;

    map.on("mouseenter", "building-dots", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "building-dots", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", "building-dots", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["building-dots"] });
      if (features.length) {
        const f = features[0];
        map.flyTo({
          center: f.geometry.coordinates,
          zoom: 17,
          speed: 0.8,
          curve: 1.8,
          easing: (t) => t * (2 - t),
          duration: 1500,
        });
        if (onBuildingSelect) {
          onBuildingSelect(
            {
              name: f.properties.name,
              code: f.properties.code,
              longitude: f.geometry.coordinates[0],
              latitude: f.geometry.coordinates[1],
            },
            true
          );
        }
      }
    });
  }, [onBuildingSelect]);

  // Navigate to nearest available building (map button)
  const handleNavigate = useCallback(() => {
    if (routeStateRef.current.active) {
      clearRoute();
      return;
    }

    if (!liveDataReady) {
      alert("Still loading live room availability. Try again in a moment.");
      return;
    }

    if (!buildingsDataRef.current) return;

    const data = buildingsDataRef.current;
    const available = data.filter(
      (b) => getBuildingAvailability(b.classrooms, availabilityStart, availabilityEnd) === "Available"
    );

    if (available.length === 0) {
      alert("No available buildings found for the selected time.");
      return;
    }

    // We need user location to find nearest — get it, then pick closest
    setNavigating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;

        const sorted = available
          .map((b) => ({ ...b, dist: haversineDistance(userLng, userLat, b.longitude, b.latitude) }))
          .sort((a, b) => a.dist - b.dist);

        const nearest = sorted[0];
        if (onBuildingSelect) {
          onBuildingSelect(
            { name: nearest.name, code: nearest.code, longitude: nearest.longitude, latitude: nearest.latitude },
            true
          );
        }

        setNavigating(false);
        routeToBuilding(nearest);
      },
      (err) => {
        setNavigating(false);
        if (err.code === err.PERMISSION_DENIED) {
          alert("Location access denied. Please enable location permissions to use navigation.");
        } else {
          alert("Could not get your location. Please try again.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [availabilityStart, availabilityEnd, onBuildingSelect, clearRoute, routeToBuilding, liveDataReady]);

  // Handle navigate-to-specific-building requests from Sidebar
  useEffect(() => {
    if (navigateTarget) {
      routeToBuilding(navigateTarget);
      if (onNavigateComplete) onNavigateComplete();
    }
  }, [navigateTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize the map
  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [-76.943487, 38.987822],
      zoom: 15.51,
      pitch: 49.53,
      bearing: -35.53,
      attributionControl: false,
    });

    const isMobile = window.innerWidth <= 768;
    map.addControl(
      new mapboxgl.AttributionControl({ compact: isMobile }),
      isMobile ? "top-right" : "bottom-right"
    );

    mapRef.current = map;

    map.on("load", () => {
      isMapLoadedRef.current = true;
      setMapLoaded(true);
      buildingLayerEventsBoundRef.current = false;

      addMapLegend(map);

      if (Array.isArray(buildingsDataRef.current) && buildingsDataRef.current.length > 0) {
        updateMapData(
          map,
          buildingsDataRef.current,
          availabilityStart,
          availabilityEnd,
          selectedBuilding
        );
      }

      // If layers exist (data was present at load), bind interactions.
      ensureBuildingLayerEvents();
    });

    return () => {
      routeStateRef.current = { active: false };
      setRouteInfo(null);
      setMapLoaded(false);
      buildingLayerEventsBoundRef.current = false;
      map.remove();
    };
  }, [darkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map data when filters change
  useEffect(() => {
    if (isMapLoadedRef.current && mapRef.current && buildingsDataRef.current) {
      const map = mapRef.current;
      const nextData = Array.isArray(buildingsData) ? buildingsData : [];
      if (map.isStyleLoaded()) {
        updateMapData(map, nextData, availabilityStart, availabilityEnd, selectedBuilding);
        ensureBuildingLayerEvents();
      } else {
        map.once("styledata", () => {
          updateMapData(map, nextData, availabilityStart, availabilityEnd, selectedBuilding);
          ensureBuildingLayerEvents();
        });
      }
    }
  }, [availabilityStart, availabilityEnd, selectedBuilding, updateMapData, buildingsData, ensureBuildingLayerEvents]);

  useEffect(() => {
    const map = mapRef.current;

    if (loadingPulseRef.current) {
      clearInterval(loadingPulseRef.current);
      loadingPulseRef.current = null;
    }
    if (loadingAnimationFrameRef.current) {
      cancelAnimationFrame(loadingAnimationFrameRef.current);
      loadingAnimationFrameRef.current = null;
    }

    if (!map || !isMapLoadedRef.current || !map.getLayer("building-dots-glow")) {
      return;
    }

    if (liveDataReady) {
      updateMapData(
        map,
        Array.isArray(buildingsData) ? buildingsData : [],
        availabilityStart,
        availabilityEnd,
        selectedBuilding
      );
      applyDotLayerStyles(map);
      return;
    }

    const animate = () => {
      if (!map.getLayer("building-dots-glow") || !map.getLayer("building-dots")) return;
      const phase = (Date.now() % 1400) / 1400;
      const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      const loadingColor = wave > 0.5 ? DOT_COLORS.loadingB : DOT_COLORS.loadingA;
      map.setPaintProperty("building-dots-glow", "circle-color", loadingColor);
      map.setPaintProperty("building-dots-glow", "circle-radius", 8 + wave * 4.8);
      map.setPaintProperty("building-dots-glow", "circle-opacity", 0.18 + wave * 0.44);
      map.setPaintProperty("building-dots", "circle-color", loadingColor);
      map.setPaintProperty("building-dots", "circle-radius", 4 + wave * 1.1);
      map.setPaintProperty("building-dots", "circle-opacity", 0.9 + wave * 0.1);
      map.triggerRepaint();
      loadingAnimationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (loadingPulseRef.current) {
        clearInterval(loadingPulseRef.current);
        loadingPulseRef.current = null;
      }
      if (loadingAnimationFrameRef.current) {
        cancelAnimationFrame(loadingAnimationFrameRef.current);
        loadingAnimationFrameRef.current = null;
      }
    };
  }, [
    applyDotLayerStyles,
    availabilityEnd,
    availabilityStart,
    buildingsData,
    liveDataReady,
    mapLoaded,
    selectedBuilding,
    updateMapData,
  ]);

  // Fly to selected building
  useEffect(() => {
    if (selectedBuilding && mapRef.current) {
      mapRef.current.flyTo({
        center: [selectedBuilding.longitude, selectedBuilding.latitude],
        zoom: 17,
        speed: 0.8,
        curve: 1.8,
        easing: (t) => t * (2 - t),
        duration: 1500,
      });
    }
  }, [selectedBuilding]);

  // Clear route when a different building is manually selected
  useEffect(() => {
    if (
      routeStateRef.current.active &&
      selectedBuilding &&
      routeStateRef.current.targetBuilding &&
      selectedBuilding.code !== routeStateRef.current.targetBuilding.code
    ) {
      clearRoute();
    }
  }, [selectedBuilding, clearRoute]);

  const handleRecenter = () => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [-76.943487, 38.987822],
        zoom: 15.7,
        speed: 0.8,
        curve: 1.8,
        easing: (t) => t * (2 - t),
        duration: 1800,
      });
    }
  };

  const handleRecenterUser = () => {
    if (!mapRef.current) return;
    if (userLocation) {
      mapRef.current.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 16.5,
        speed: 0.8,
        curve: 1.8,
        easing: (t) => t * (2 - t),
        duration: 1500,
      });
    } else {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapRef.current.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 16.5,
            speed: 0.8,
            curve: 1.8,
            easing: (t) => t * (2 - t),
            duration: 1500,
          });
        },
        () => {
          alert("Could not get your location. Please enable location permissions.");
        },
        { enableHighAccuracy: false, timeout: 10000 }
      );
    }
  };

  return (
    <div className="map-wrapper">
      <div className="map-inner-container" ref={mapContainerRef} />

      <div className="map-controls">
        <button
          className={`map-navigate-btn${routeStateRef.current.active ? " active" : ""}${navigating ? " loading" : ""}`}
          title={routeStateRef.current.active ? "Clear route" : "Navigate to nearest available building"}
          onClick={handleNavigate}
          aria-label={routeStateRef.current.active ? "Clear route" : "Navigate to nearest available building"}
        >
          {navigating ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <path d="M8 16h8l-4 5-4-5z" />
            </svg>
          )}
        </button>

        <button
          className="map-recenter-btn"
          title="Recenter campus"
          onClick={handleRecenter}
          aria-label="Recenter campus"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3" />
            <path d="M12 19v3" />
            <path d="M2 12h3" />
            <path d="M19 12h3" />
          </svg>
        </button>

        <button
          className="map-mylocation-btn"
          title="Go to my location"
          onClick={handleRecenterUser}
          aria-label="Go to my location"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </button>
      </div>

      {routeInfo && (
        <div className="route-info-card">
          <div className="route-info-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className="route-info-details">
            <div className="route-info-stats">
              {routeInfo.distance} <span>·</span> {routeInfo.duration}
            </div>
            <div className="route-info-name">{routeInfo.buildingName}</div>
          </div>
          <button
            className="route-info-dismiss"
            onClick={clearRoute}
            aria-label="Dismiss route"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default Map;
