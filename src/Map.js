import React, { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "./Map.css";
import { getBuildingAvailability, getClassroomAvailability } from "./availability";
import { addMapLegend } from "./legend";
import { getParkingFeatures, getParkingReferenceDate, getParkingStatusLabel } from "./parkingData";
import {
  playMapFocusHaptic,
  playMapTapHaptic,
  playNavigationClearHaptic,
  playNavigationErrorHaptic,
  playNavigationStartHaptic,
  playNavigationSuccessHaptic,
  playRecenterHaptic,
} from "./haptics";

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;

const MAP_STYLE = "mapbox://styles/remagi/cm31ucjm700q901qke5264xrp";
const DEFAULT_MAP_CENTER = [-76.943487, 38.987822];
const DEFAULT_MAP_ZOOM = 15.51;
const DEFAULT_MAP_PITCH = 49.53;
const DEFAULT_MAP_BEARING = -35.53;
const DOT_COLORS = {
  available: "#4CFF88",
  openingSoon: "#FFD60A",
  unavailable: "#FF4B57",
  loadingA: "#4FD8FF",
  loadingB: "#A6EEFF",
  muted: "#8E8E93",
};

const PARKING_COLORS = {
  Free: "#34C759",
  Restricted: "#FF3B30",
  Visitor: "#FFCC00",
};

const BOOKABLE_COLORS = {
  available: DOT_COLORS.available,
  openingSoon: DOT_COLORS.openingSoon,
  unavailable: DOT_COLORS.unavailable,
  haloAvailable: "rgba(76,255,136,0.28)",
  haloOpeningSoon: "rgba(255,214,10,0.24)",
  haloUnavailable: "rgba(255,75,87,0.24)",
  label: "#FFFFFF",
};

function offsetCoordinates(longitude, latitude, radiusMeters, angleRadians) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = Math.max(1, 111320 * Math.cos((latitude * Math.PI) / 180));
  const deltaLat = (Math.sin(angleRadians) * radiusMeters) / metersPerDegreeLat;
  const deltaLng = (Math.cos(angleRadians) * radiusMeters) / metersPerDegreeLng;
  return [longitude + deltaLng, latitude + deltaLat];
}

function getBookableBuildingStatus(building, start, end) {
  const libCalRooms = (building.classrooms || []).filter((room) => room?.source === "libcal");
  if (!libCalRooms.length) return null;

  let hasOpeningSoon = false;
  for (const room of libCalRooms) {
    const status = getClassroomAvailability(room, start, end);
    if (status === "Available") return "Available";
    if (status === "Opening Soon") hasOpeningSoon = true;
  }

  return hasOpeningSoon ? "Opening Soon" : "Unavailable";
}

function getBookableRoomFeatures(data, start, end, selectedBuildingCode) {
  return (Array.isArray(data) ? data : [])
    .map((building) => {
      const libCalRooms = (building.classrooms || []).filter((room) => room?.source === "libcal");
      if (!libCalRooms.length) return null;
      const bookableCount = libCalRooms.filter(
        (room) => getClassroomAvailability(room, start, end) === "Available"
      ).length;
      const buildingStatus = getBookableBuildingStatus(building, start, end);

      const [lng, lat] = offsetCoordinates(
        building.longitude,
        building.latitude,
        18,
        -Math.PI / 3
      );

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: {
          id: `bookable-${building.code}`,
          buildingCode: building.code,
          buildingName: building.name,
          selected: selectedBuildingCode && selectedBuildingCode === building.code,
          bookableCount,
          bookableStatus: buildingStatus,
          trueLongitude: building.longitude,
          trueLatitude: building.latitude,
        },
      };
    })
    .filter(Boolean);
}

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
  onRoomSelect,
  onParkingSelect,
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
  const bookableLayerEventsBoundRef = useRef(false);
  const parkingLayerEventsBoundRef = useRef(false);
  const loadingPulseRef = useRef(null);
  const loadingAnimationFrameRef = useRef(null);
  const parkingPopupRef = useRef(null);
  const bookablePopupRef = useRef(null);

  const [navigating, setNavigating] = useState(false); // loading spinner
  const [routeInfo, setRouteInfo] = useState(null); // { distance, duration, buildingName }
  const [mapLoaded, setMapLoaded] = useState(false);
  const usesExplicitAvailabilityTime = viewMode !== "now";
  const availabilityStart = usesExplicitAvailabilityTime ? selectedStartDateTime : null;
  const availabilityEnd =
    viewMode === "schedule"
      ? selectedEndDateTime
      : usesExplicitAvailabilityTime
      ? selectedStartDateTime
      : null;
  const parkingReferenceDate = getParkingReferenceDate(viewMode, selectedStartDateTime);

  const getDotColorExpression = useCallback(() => ([
    "case",
    ["get", "selected"],
    "#FFFFFF",
    [
      "match",
      ["get", "availabilityStatus"],
      "Available", DOT_COLORS.available,
      "Opening Soon", DOT_COLORS.openingSoon,
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
  }, [getDotColorExpression, liveDataReady]);

  const moveParkingLayersToFront = useCallback((map) => {
    ["parking-markers-glow", "parking-markers", "parking-labels", "parking-hit-area"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId);
      }
    });
  }, []);

  const moveBookableLayersToFront = useCallback((map) => {
    ["bookable-rooms-glow", "bookable-rooms", "bookable-room-labels", "bookable-room-hit-area"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId);
      }
    });
  }, []);

  const updateMapData = useCallback((map, data, start, end, selected) => {
    const features = data
      .filter((building) => !(building.classrooms || []).some((room) => room?.source === "libcal"))
      .map((building, i) => ({
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
      moveParkingLayersToFront(map);
      moveBookableLayersToFront(map);
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
      moveParkingLayersToFront(map);
      moveBookableLayersToFront(map);
    }
  }, [applyDotLayerStyles, getDotColorExpression, liveDataReady, moveBookableLayersToFront, moveParkingLayersToFront]);

  const applyBookableLayerStyles = useCallback((map) => {
    const colorExpr = [
      "case",
      ["get", "selected"],
      "#FFFFFF",
      [
        "match",
        ["get", "bookableStatus"],
        "Available", BOOKABLE_COLORS.available,
        "Opening Soon", BOOKABLE_COLORS.openingSoon,
        "Unavailable", BOOKABLE_COLORS.unavailable,
        BOOKABLE_COLORS.unavailable,
      ],
    ];
    const glowExpr = [
      "match",
      ["get", "bookableStatus"],
      "Available", BOOKABLE_COLORS.haloAvailable,
      "Opening Soon", BOOKABLE_COLORS.haloOpeningSoon,
      "Unavailable", BOOKABLE_COLORS.haloUnavailable,
      BOOKABLE_COLORS.haloUnavailable,
    ];

    if (map.getLayer("bookable-rooms-glow")) {
      map.setPaintProperty("bookable-rooms-glow", "circle-color", glowExpr);
      map.setPaintProperty("bookable-rooms-glow", "circle-radius", 10.5);
      map.setPaintProperty("bookable-rooms-glow", "circle-opacity", 0.28);
      map.setPaintProperty("bookable-rooms-glow", "circle-blur", 0.95);
      map.setPaintProperty("bookable-rooms-glow", "circle-emissive-strength", 1);
    }

    if (map.getLayer("bookable-rooms")) {
      map.setPaintProperty("bookable-rooms", "circle-color", colorExpr);
      map.setPaintProperty("bookable-rooms", "circle-radius", 6.2);
      map.setPaintProperty("bookable-rooms", "circle-stroke-width", 1.35);
      map.setPaintProperty("bookable-rooms", "circle-stroke-color", "rgba(255,255,255,0.82)");
      map.setPaintProperty("bookable-rooms", "circle-emissive-strength", 1);
    }
  }, []);

  const updateBookableRoomData = useCallback((map, data, start, end) => {
    const geojson = {
      type: "FeatureCollection",
      features: getBookableRoomFeatures(data, start, end, selectedBuilding?.code),
    };

    if (map.getSource("bookable-rooms")) {
      map.getSource("bookable-rooms").setData(geojson);
      applyBookableLayerStyles(map);
      moveParkingLayersToFront(map);
      moveBookableLayersToFront(map);
      return;
    }

    map.addSource("bookable-rooms", { type: "geojson", data: geojson });

    map.addLayer({
      id: "bookable-rooms-glow",
      type: "circle",
      source: "bookable-rooms",
      paint: {
        "circle-radius": 10.5,
        "circle-color": BOOKABLE_COLORS.haloAvailable,
        "circle-opacity": 0.28,
        "circle-blur": 0.95,
        "circle-emissive-strength": 1,
      },
    });

    map.addLayer({
      id: "bookable-rooms",
      type: "circle",
      source: "bookable-rooms",
      paint: {
        "circle-radius": 6.2,
        "circle-color": BOOKABLE_COLORS.available,
        "circle-stroke-width": 1.35,
        "circle-stroke-color": "rgba(255,255,255,0.82)",
        "circle-emissive-strength": 1,
      },
    });

    map.addLayer({
      id: "bookable-room-labels",
      type: "symbol",
      source: "bookable-rooms",
      layout: {
        "text-field": "B",
        "text-size": 9.5,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": BOOKABLE_COLORS.label,
        "text-halo-color": "rgba(10,132,255,0.24)",
        "text-halo-width": 0.3,
      },
    });

    map.addLayer({
      id: "bookable-room-hit-area",
      type: "circle",
      source: "bookable-rooms",
      paint: {
        "circle-radius": 15,
        "circle-opacity": 0,
      },
    });

    applyBookableLayerStyles(map);
    moveParkingLayersToFront(map);
    moveBookableLayersToFront(map);
  }, [applyBookableLayerStyles, moveBookableLayersToFront, moveParkingLayersToFront, selectedBuilding]);

  const getParkingColorExpression = useCallback(() => ([
    "match",
    ["get", "parkingStatus"],
    "Free", PARKING_COLORS.Free,
    "Restricted", PARKING_COLORS.Restricted,
    "Visitor", PARKING_COLORS.Visitor,
    PARKING_COLORS.Visitor,
  ]), []);

  const applyParkingLayerStyles = useCallback((map) => {
    const colorExpr = getParkingColorExpression();

    if (map.getLayer("parking-markers-glow")) {
      map.setPaintProperty("parking-markers-glow", "circle-color", colorExpr);
      map.setPaintProperty("parking-markers-glow", "circle-radius", 11.5);
      map.setPaintProperty("parking-markers-glow", "circle-opacity", 0.2);
      map.setPaintProperty("parking-markers-glow", "circle-blur", 0.9);
      map.setPaintProperty("parking-markers-glow", "circle-emissive-strength", 1);
    }

    if (map.getLayer("parking-markers")) {
      map.setPaintProperty("parking-markers", "circle-color", colorExpr);
      map.setPaintProperty("parking-markers", "circle-radius", 8);
      map.setPaintProperty("parking-markers", "circle-stroke-width", 1.3);
      map.setPaintProperty("parking-markers", "circle-stroke-color", "rgba(17,17,17,0.28)");
      map.setPaintProperty("parking-markers", "circle-emissive-strength", 1);
    }
  }, [getParkingColorExpression]);


  const updateParkingData = useCallback((map, referenceDate) => {
    const geojson = {
      type: "FeatureCollection",
      features: getParkingFeatures(referenceDate).map((feature, index) => ({
        ...feature,
        properties: {
          ...feature.properties,
          id: index,
          parkingStatus: feature.properties.status,
        },
      })),
    };

    if (map.getSource("parking")) {
      map.getSource("parking").setData(geojson);
      applyParkingLayerStyles(map);
      moveParkingLayersToFront(map);
      moveBookableLayersToFront(map);
      return;
    }

    map.addSource("parking", { type: "geojson", data: geojson });

    map.addLayer({
      id: "parking-markers-glow",
      type: "circle",
      source: "parking",
      paint: {
        "circle-radius": 11.5,
        "circle-color": getParkingColorExpression(),
        "circle-opacity": 0.2,
        "circle-blur": 0.9,
        "circle-emissive-strength": 1,
      },
    });

    map.addLayer({
      id: "parking-markers",
      type: "circle",
      source: "parking",
      paint: {
        "circle-radius": 8,
        "circle-color": getParkingColorExpression(),
        "circle-stroke-width": 1.3,
        "circle-stroke-color": "rgba(17,17,17,0.28)",
        "circle-emissive-strength": 1,
      },
    });

    map.addLayer({
      id: "parking-labels",
      type: "symbol",
      source: "parking",
      layout: {
        "text-field": "P",
        "text-size": 8.5,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#111111",
        "text-halo-color": "rgba(255,255,255,0.55)",
        "text-halo-width": 0.4,
      },
    });

    map.addLayer({
      id: "parking-hit-area",
      type: "circle",
      source: "parking",
      paint: {
        "circle-radius": 16,
        "circle-opacity": 0,
      },
    });

    applyParkingLayerStyles(map);
    moveParkingLayersToFront(map);
    moveBookableLayersToFront(map);
  }, [applyParkingLayerStyles, getParkingColorExpression, moveBookableLayersToFront, moveParkingLayersToFront]);

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
    playNavigationStartHaptic();

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
              playNavigationErrorHaptic();
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
            playNavigationSuccessHaptic();
          })
          .catch((err) => {
            console.error("Route fetch error:", err);
            setNavigating(false);
            playNavigationErrorHaptic();
            alert("Failed to fetch walking route.");
          });
      },
      (err) => {
        setNavigating(false);
        playNavigationErrorHaptic();
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
        playMapFocusHaptic();
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

  const ensureBookableLayerEvents = useCallback(() => {
    const map = mapRef.current;
    if (!map || bookableLayerEventsBoundRef.current) return;
    if (!map.getLayer("bookable-rooms")) return;

    bookableLayerEventsBoundRef.current = true;
    const interactiveLayers = ["bookable-room-hit-area", "bookable-room-labels", "bookable-rooms"];

    const showBookableRoom = (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: interactiveLayers.filter((layerId) => map.getLayer(layerId)),
      });
      const feature = features[0];
      if (!feature) return;

      playMapTapHaptic();

      if (bookablePopupRef.current) {
        bookablePopupRef.current.remove();
      }

      bookablePopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        offset: 18,
        className: "parking-popup",
      })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(
          [
            `<div class="parking-popup-title">${feature.properties.buildingName}</div>`,
            `<div class="parking-popup-status parking-popup-status--${String(feature.properties.bookableStatus || "").toLowerCase().replace(/\s+/g, "-")}">${String(feature.properties.bookableStatus || "Unavailable")}</div>`,
            `<div class="parking-popup-copy">${feature.properties.bookableCount} room${Number(feature.properties.bookableCount) === 1 ? "" : "s"} bookable now</div>`,
          ].join("")
        )
        .addTo(map);

      map.flyTo({
        center: feature.geometry.coordinates,
        zoom: Math.max(map.getZoom(), 17.2),
        speed: 0.8,
        curve: 1.5,
        easing: (t) => t * (2 - t),
        duration: 1200,
      });

      if (onBuildingSelect) {
        onBuildingSelect(
          {
            name: feature.properties.buildingName,
            code: feature.properties.buildingCode,
            longitude: Number(feature.properties.trueLongitude ?? feature.geometry.coordinates[0]),
            latitude: Number(feature.properties.trueLatitude ?? feature.geometry.coordinates[1]),
          },
          true
        );
      }
    };

    interactiveLayers.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;

      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", layerId, showBookableRoom);
    });
  }, [onBuildingSelect]);

  const ensureParkingLayerEvents = useCallback(() => {
    const map = mapRef.current;
    if (!map || parkingLayerEventsBoundRef.current) return;
    if (!map.getLayer("parking-markers")) return;

    parkingLayerEventsBoundRef.current = true;

    const interactiveParkingLayers = ["parking-hit-area", "parking-labels", "parking-markers"];

    const showParkingPopup = (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: interactiveParkingLayers.filter((layerId) => map.getLayer(layerId)),
      });
      const feature = features[0];
      if (!feature) return;
      playMapTapHaptic();

      if (parkingPopupRef.current) {
        parkingPopupRef.current.remove();
      }

      parkingPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        offset: 18,
        className: "parking-popup",
      })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(
          [
            `<div class="parking-popup-title">${feature.properties.name}</div>`,
            `<div class="parking-popup-status parking-popup-status--${String(feature.properties.parkingStatus || "").toLowerCase()}">${getParkingStatusLabel(feature.properties.parkingStatus)}</div>`,
            `<div class="parking-popup-copy">${feature.properties.description || ""}</div>`,
            `<div class="parking-popup-copy parking-popup-copy--secondary">${feature.properties.detail || ""}</div>`,
          ].join("")
        )
        .addTo(map);

      if (onParkingSelect) {
        onParkingSelect({
          name: feature.properties.name,
          status: feature.properties.parkingStatus,
          description: feature.properties.description || "",
          detail: feature.properties.detail || "",
          longitude: feature.properties.trueLongitude ?? feature.geometry.coordinates[0],
          latitude: feature.properties.trueLatitude ?? feature.geometry.coordinates[1],
        });
      }
    };

    interactiveParkingLayers.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;

      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", layerId, showParkingPopup);
    });
  }, [onParkingSelect]);

  // Navigate to nearest available building (map button)
  const handleNavigate = useCallback(() => {
    if (routeStateRef.current.active) {
      playNavigationClearHaptic();
      clearRoute();
      return;
    }

    if (!liveDataReady) {
      playNavigationErrorHaptic();
      alert("Still loading live room availability. Try again in a moment.");
      return;
    }

    if (!buildingsDataRef.current) return;

    const data = buildingsDataRef.current;
    const available = data.filter(
      (b) => getBuildingAvailability(b.classrooms, availabilityStart, availabilityEnd) === "Available"
    );

    if (available.length === 0) {
      playNavigationErrorHaptic();
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
        playNavigationErrorHaptic();
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
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      pitch: DEFAULT_MAP_PITCH,
      bearing: DEFAULT_MAP_BEARING,
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
      bookableLayerEventsBoundRef.current = false;
      parkingLayerEventsBoundRef.current = false;

      addMapLegend(map);
      updateBookableRoomData(
        map,
        buildingsDataRef.current,
        availabilityStart,
        availabilityEnd
      );
      ensureBookableLayerEvents();
      updateParkingData(map, parkingReferenceDate);
      ensureParkingLayerEvents();

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
      bookableLayerEventsBoundRef.current = false;
      parkingLayerEventsBoundRef.current = false;
      if (parkingPopupRef.current) {
        parkingPopupRef.current.remove();
        parkingPopupRef.current = null;
      }
      if (bookablePopupRef.current) {
        bookablePopupRef.current.remove();
        bookablePopupRef.current = null;
      }
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
        updateBookableRoomData(map, nextData, availabilityStart, availabilityEnd);
        ensureBuildingLayerEvents();
        ensureBookableLayerEvents();
      } else {
        map.once("styledata", () => {
          updateMapData(map, nextData, availabilityStart, availabilityEnd, selectedBuilding);
          updateBookableRoomData(map, nextData, availabilityStart, availabilityEnd);
          ensureBuildingLayerEvents();
          ensureBookableLayerEvents();
        });
      }
    }
  }, [availabilityStart, availabilityEnd, selectedBuilding, updateMapData, updateBookableRoomData, buildingsData, ensureBuildingLayerEvents, ensureBookableLayerEvents]);

  useEffect(() => {
    if (!isMapLoadedRef.current || !mapRef.current) return;
    const map = mapRef.current;
    if (map.isStyleLoaded()) {
      updateParkingData(map, parkingReferenceDate);
      ensureParkingLayerEvents();
    } else {
      map.once("styledata", () => {
        updateParkingData(map, parkingReferenceDate);
        ensureParkingLayerEvents();
      });
    }
  }, [parkingReferenceDate, updateParkingData, ensureParkingLayerEvents]);

  useEffect(() => {
    if (!isMapLoadedRef.current || !mapRef.current) return;
    const map = mapRef.current;
    const nextData = Array.isArray(buildingsData) ? buildingsData : [];
    if (map.isStyleLoaded()) {
      updateBookableRoomData(map, nextData, availabilityStart, availabilityEnd);
      ensureBookableLayerEvents();
    } else {
      map.once("styledata", () => {
        updateBookableRoomData(map, nextData, availabilityStart, availabilityEnd);
        ensureBookableLayerEvents();
      });
    }
  }, [availabilityStart, availabilityEnd, buildingsData, updateBookableRoomData, ensureBookableLayerEvents]);

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
    if (!mapRef.current) return;
    playRecenterHaptic();
    mapRef.current.flyTo({
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      pitch: DEFAULT_MAP_PITCH,
      bearing: DEFAULT_MAP_BEARING,
      speed: 0.8,
      curve: 1.8,
      easing: (t) => t * (2 - t),
      duration: 1500,
    });
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
          className="map-mylocation-btn"
          title="Recenter map"
          onClick={handleRecenter}
          aria-label="Recenter map"
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
