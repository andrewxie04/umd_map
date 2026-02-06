import React, { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "./Map.css";
import { getBuildingAvailability } from "./availability";
import { addMapLegend } from "./legend";

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;

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
  selectedBuilding,
  onBuildingSelect,
  selectedStartDateTime,
  selectedEndDateTime,
  darkMode,
  navigateTarget,
  onNavigateComplete,
}) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const buildingsDataRef = useRef(null);
  const isMapLoadedRef = useRef(false);
  const routeStateRef = useRef({ active: false });

  const [navigating, setNavigating] = useState(false); // loading spinner
  const [routeInfo, setRouteInfo] = useState(null); // { distance, duration, buildingName }

  const updateMapData = useCallback((map, data, start, end, selected) => {
    const features = data.map((building, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [building.longitude, building.latitude] },
      properties: {
        id: i,
        name: building.name,
        code: building.code,
        availabilityStatus: getBuildingAvailability(building.classrooms, start, end),
        selected: selected && building.code === selected.code ? true : false,
      },
    }));

    const geojson = { type: "FeatureCollection", features };

    if (map.getSource("buildings")) {
      map.getSource("buildings").setData(geojson);
    } else {
      map.addSource("buildings", { type: "geojson", data: geojson });

      const colorExpr = [
        "case",
        ["get", "selected"],
        darkMode ? "#FFFFFF" : "#000000",
        [
          "match",
          ["get", "availabilityStatus"],
          "Available", "#34C759",
          "Unavailable", "#FF3B30",
          "No availability data", "#8E8E93",
          "#8E8E93",
        ],
      ];

      map.addLayer({
        id: "building-dots-glow",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": 10,
          "circle-color": colorExpr,
          "circle-opacity": 0.5,
          "circle-blur": 0.6,
        },
      });

      map.addLayer({
        id: "building-dots",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": 5,
          "circle-color": colorExpr,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": darkMode
            ? "rgba(255,255,255,0.3)"
            : "rgba(255,255,255,0.8)",
          "circle-opacity": 1,
        },
      });
    }
  }, [darkMode]);

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

  // Navigate to nearest available building (map button)
  const handleNavigate = useCallback(() => {
    if (routeStateRef.current.active) {
      clearRoute();
      return;
    }

    if (!buildingsDataRef.current) return;

    const data = buildingsDataRef.current;
    const available = data.filter(
      (b) => getBuildingAvailability(b.classrooms, selectedStartDateTime, selectedEndDateTime) === "Available"
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
  }, [selectedStartDateTime, selectedEndDateTime, onBuildingSelect, clearRoute, routeToBuilding]);

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
      style: darkMode
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/remagi/cm32mhtye00ve01pd1opq9gaj",
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

      fetch(process.env.PUBLIC_URL + "/buildings_data.json")
        .then((r) => {
          if (!r.ok) throw new Error("Network response was not ok");
          return r.json();
        })
        .then((data) => {
          buildingsDataRef.current = data;
          updateMapData(map, data, selectedStartDateTime, selectedEndDateTime, selectedBuilding);
          addMapLegend(map);

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
        })
        .catch((err) => console.error("Error loading building data:", err));
    });

    return () => {
      routeStateRef.current = { active: false };
      setRouteInfo(null);
      map.remove();
    };
  }, [darkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map data when filters change
  useEffect(() => {
    if (isMapLoadedRef.current && mapRef.current && buildingsDataRef.current) {
      const map = mapRef.current;
      if (map.isStyleLoaded()) {
        updateMapData(map, buildingsDataRef.current, selectedStartDateTime, selectedEndDateTime, selectedBuilding);
      } else {
        map.once("styledata", () => {
          updateMapData(map, buildingsDataRef.current, selectedStartDateTime, selectedEndDateTime, selectedBuilding);
        });
      }
    }
  }, [selectedStartDateTime, selectedEndDateTime, selectedBuilding, updateMapData]);

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

  return (
    <div className="map-wrapper">
      <div className="map-inner-container" ref={mapContainerRef} />

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
        title="Recenter map"
        onClick={handleRecenter}
        aria-label="Recenter map"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11" />
        </svg>
      </button>

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
