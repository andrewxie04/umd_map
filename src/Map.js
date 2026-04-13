import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./Map.css";
import { getBuildingAvailability, getClassroomAvailability } from "./availability";
import { LIBCAL_BUILDING_METADATA } from "./libcalData";
import { addMapLegend } from "./legend";
import { getParkingFeatures, getParkingReferenceDate } from "./parkingData";
import { getDiningStatusInfo } from "./diningData";
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
const MOBILE_MAP_CENTER = [-76.943487, 38.9866];
const DEFAULT_MAP_ZOOM = 15.51;
const MOBILE_MAP_ZOOM = 14.72;
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
  loading: DOT_COLORS.loadingA,
  haloAvailable: "rgba(76,255,136,0.28)",
  haloOpeningSoon: "rgba(255,214,10,0.24)",
  haloUnavailable: "rgba(255,75,87,0.24)",
  haloLoading: "rgba(79,216,255,0.22)",
  label: "#FFFFFF",
};

const DINING_COLORS = {
  available: DOT_COLORS.available,
  openingSoon: DOT_COLORS.openingSoon,
  unavailable: DOT_COLORS.unavailable,
  haloAvailable: "rgba(76,255,136,0.22)",
  haloOpeningSoon: "rgba(255,214,10,0.18)",
  haloUnavailable: "rgba(255,75,87,0.2)",
  label: "#FFFFFF",
};

const LIBCAL_BUILDING_CODES = new Set(LIBCAL_BUILDING_METADATA.map((building) => building.code));

function getDefaultCamera(isMobile) {
  return {
    center: isMobile ? MOBILE_MAP_CENTER : DEFAULT_MAP_CENTER,
    zoom: isMobile ? MOBILE_MAP_ZOOM : DEFAULT_MAP_ZOOM,
    pitch: DEFAULT_MAP_PITCH,
    bearing: DEFAULT_MAP_BEARING,
  };
}

function offsetCoordinates(longitude, latitude, radiusMeters, angleRadians) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = Math.max(1, 111320 * Math.cos((latitude * Math.PI) / 180));
  const deltaLat = (Math.sin(angleRadians) * radiusMeters) / metersPerDegreeLat;
  const deltaLng = (Math.cos(angleRadians) * radiusMeters) / metersPerDegreeLng;
  return [longitude + deltaLng, latitude + deltaLat];
}

function getBookableBuildingStatus(building, start, end) {
  const libCalRooms = (building.classrooms || []).filter((room) => room?.source === "libcal");
  if (!libCalRooms.length) {
    return "Loading";
  }

  let hasOpeningSoon = false;
  for (const room of libCalRooms) {
    const status = getClassroomAvailability(room, start, end);
    if (status === "Available") return "Available";
    if (status === "Opening Soon") hasOpeningSoon = true;
  }

  return hasOpeningSoon ? "Opening Soon" : "Unavailable";
}

function getBookableRoomFeatures(data, start, end, selectedBuildingCode) {
  const buildingLookup = new Map(
    (Array.isArray(data) ? data : []).map((building) => [building.code, building])
  );

  return LIBCAL_BUILDING_METADATA.map((meta) => {
    const resolvedBuilding = buildingLookup.get(meta.code);
    const building = resolvedBuilding || meta;
    const libCalRooms = (resolvedBuilding?.classrooms || []).filter((room) => room?.source === "libcal");
    const bookableCount = libCalRooms.filter(
      (room) => getClassroomAvailability(room, start, end) === "Available"
    ).length;
    const buildingStatus = getBookableBuildingStatus({ classrooms: libCalRooms }, start, end);

    const [lng, lat] = offsetCoordinates(
      Number(building.longitude ?? meta.longitude),
      Number(building.latitude ?? meta.latitude),
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
        id: `bookable-${meta.code}`,
        buildingCode: meta.code,
        buildingName: building.name || meta.name,
        label: "B",
        selected: Boolean(selectedBuildingCode && selectedBuildingCode === meta.code),
        bookableCount,
        bookableStatus: buildingStatus,
        trueLongitude: Number(building.longitude ?? meta.longitude),
        trueLatitude: Number(building.latitude ?? meta.latitude),
      },
    };
  });
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

const CampusMap = ({
  buildingsData,
  diningHalls,
  liveDataReady,
  selectedBuilding,
  selectedDining,
  onBuildingSelect,
  onRoomSelect,
  onParkingSelect,
  onDiningSelect,
  selectedStartDateTime,
  selectedEndDateTime,
  viewMode,
  darkMode,
  navigateTarget,
  onNavigateComplete,
  userLocation,
  mapResetToken,
}) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const buildingsDataRef = useRef([]);
  const diningHallsRef = useRef([]);
  const isMapLoadedRef = useRef(false);
  const routeStateRef = useRef({ active: false });
  const buildingLayerEventsBoundRef = useRef(false);
  const bookableLayerEventsBoundRef = useRef(false);
  const parkingLayerEventsBoundRef = useRef(false);
  const diningLayerEventsBoundRef = useRef(false);
  const diningMarkerImagesLoadedRef = useRef(false);
  const diningMarkerImagesLoadingRef = useRef(null);
  const loadingPulseRef = useRef(null);
  const loadingAnimationFrameRef = useRef(null);

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
  const diningReferenceDate = useMemo(
    () => (usesExplicitAvailabilityTime ? selectedStartDateTime : new Date()),
    [usesExplicitAvailabilityTime, selectedStartDateTime]
  );

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
      map.setPaintProperty("building-dots-glow", "circle-radius", liveDataReady ? 10.2 : 8.9);
      map.setPaintProperty("building-dots-glow", "circle-opacity", liveDataReady ? 0.82 : 0.38);
      map.setPaintProperty("building-dots-glow", "circle-blur", 1.08);
      map.setPaintProperty("building-dots-glow", "circle-emissive-strength", 1);
    }

    if (map.getLayer("building-dots")) {
      map.setPaintProperty("building-dots", "circle-color", colorExpr);
      map.setPaintProperty("building-dots", "circle-radius", liveDataReady ? 4.25 : 4.0);
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

  const moveDiningLayersToFront = useCallback((map) => {
    ["dining-markers-glow", "dining-markers", "dining-labels", "dining-hit-area"].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId);
      }
    });
  }, []);

  const updateMapData = useCallback((map, data, start, end, selected) => {
    const features = data
      .filter((building) => !LIBCAL_BUILDING_CODES.has(building.code) && !(building.classrooms || []).some((room) => room?.source === "libcal"))
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
      moveDiningLayersToFront(map);
    } else {
      map.addSource("buildings", { type: "geojson", data: geojson });

      map.addLayer({
        id: "building-dots-glow",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": liveDataReady ? 10.2 : 8.9,
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
          "circle-radius": liveDataReady ? 4.25 : 4.0,
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
      moveDiningLayersToFront(map);
    }
  }, [applyDotLayerStyles, getDotColorExpression, liveDataReady, moveBookableLayersToFront, moveDiningLayersToFront, moveParkingLayersToFront]);

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
        "Loading", BOOKABLE_COLORS.loading,
        BOOKABLE_COLORS.loading,
      ],
    ];
    const glowExpr = [
      "match",
      ["get", "bookableStatus"],
      "Available", BOOKABLE_COLORS.haloAvailable,
      "Opening Soon", BOOKABLE_COLORS.haloOpeningSoon,
      "Unavailable", BOOKABLE_COLORS.haloUnavailable,
      "Loading", BOOKABLE_COLORS.haloLoading,
      BOOKABLE_COLORS.haloLoading,
    ];
    const labelExpr = [
      "case",
      ["get", "selected"],
      "#111111",
      [
        "match",
        ["get", "bookableStatus"],
        "Available", "#FFFFFF",
        "Opening Soon", "#111111",
        "Unavailable", "#FFFFFF",
        "Loading", "#FFFFFF",
        "#FFFFFF",
      ],
    ];
    const haloExpr = [
      "match",
      ["get", "bookableStatus"],
      "Available", "rgba(17,17,17,0.46)",
      "Opening Soon", "rgba(255,255,255,0.58)",
      "Unavailable", "rgba(17,17,17,0.5)",
      "Loading", "rgba(17,17,17,0.42)",
      "rgba(17,17,17,0.42)",
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

    if (map.getLayer("bookable-room-labels")) {
      map.setPaintProperty("bookable-room-labels", "text-color", labelExpr);
      map.setPaintProperty("bookable-room-labels", "text-halo-color", haloExpr);
      map.setPaintProperty("bookable-room-labels", "text-halo-width", 0.7);
    }

    map.triggerRepaint();
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
      moveDiningLayersToFront(map);
      map.triggerRepaint();
      return;
    }

    map.addSource("bookable-rooms", { type: "geojson", data: geojson });

    map.addLayer({
      id: "bookable-rooms-glow",
      type: "circle",
      source: "bookable-rooms",
      paint: {
        "circle-radius": 10.5,
        "circle-color": [
          "match",
          ["get", "bookableStatus"],
          "Available", BOOKABLE_COLORS.haloAvailable,
          "Opening Soon", BOOKABLE_COLORS.haloOpeningSoon,
          "Unavailable", BOOKABLE_COLORS.haloUnavailable,
          "Loading", BOOKABLE_COLORS.haloLoading,
          BOOKABLE_COLORS.haloLoading,
        ],
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
        "circle-color": [
          "case",
          ["get", "selected"],
          "#FFFFFF",
          [
            "match",
            ["get", "bookableStatus"],
            "Available", BOOKABLE_COLORS.available,
            "Opening Soon", BOOKABLE_COLORS.openingSoon,
            "Unavailable", BOOKABLE_COLORS.unavailable,
            "Loading", BOOKABLE_COLORS.loading,
            BOOKABLE_COLORS.loading,
          ],
        ],
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
        "text-field": ["coalesce", ["get", "label"], "B"],
        "text-size": 10,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "symbol-z-order": "source",
      },
      paint: {
        "text-color": [
          "case",
          ["get", "selected"],
          "#111111",
          [
            "match",
            ["get", "bookableStatus"],
            "Available", "#FFFFFF",
            "Opening Soon", "#111111",
            "Unavailable", "#FFFFFF",
            "Loading", "#FFFFFF",
            "#FFFFFF",
          ],
        ],
        "text-halo-color": [
          "match",
          ["get", "bookableStatus"],
          "Available", "rgba(17,17,17,0.46)",
          "Opening Soon", "rgba(255,255,255,0.58)",
          "Unavailable", "rgba(17,17,17,0.5)",
          "Loading", "rgba(17,17,17,0.42)",
          "rgba(17,17,17,0.42)",
        ],
        "text-halo-width": 0.7,
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
    moveDiningLayersToFront(map);
  }, [applyBookableLayerStyles, moveBookableLayersToFront, moveDiningLayersToFront, moveParkingLayersToFront, selectedBuilding]);

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
      moveDiningLayersToFront(map);
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
    moveDiningLayersToFront(map);
  }, [applyParkingLayerStyles, getParkingColorExpression, moveBookableLayersToFront, moveDiningLayersToFront, moveParkingLayersToFront]);

  const ensureDiningMarkerImages = useCallback((map) => {
    if (diningMarkerImagesLoadedRef.current) return Promise.resolve();
    if (diningMarkerImagesLoadingRef.current) return diningMarkerImagesLoadingRef.current;

    const loadMarkerImage = (name, url) => new Promise((resolve, reject) => {
      if (map.hasImage(name)) {
        resolve();
        return;
      }

      map.loadImage(url, (error, image) => {
        if (error) {
          reject(error);
          return;
        }
        if (!image) {
          reject(new Error(`Missing image for ${name}`));
          return;
        }
        if (!map.hasImage(name)) {
          map.addImage(name, image);
        }
        resolve();
      });
    });

    const baseUrl = process.env.PUBLIC_URL || "";
    diningMarkerImagesLoadingRef.current = Promise.all([
      loadMarkerImage("dining-hall-emoji", `${baseUrl}/map-icons/dining-hall-emoji.png`),
      loadMarkerImage("market-shop-emoji", `${baseUrl}/map-icons/market-shop-emoji.png`),
    ])
      .then(() => {
        diningMarkerImagesLoadedRef.current = true;
        diningMarkerImagesLoadingRef.current = null;
      })
      .catch((error) => {
        diningMarkerImagesLoadingRef.current = null;
        throw error;
      });

    return diningMarkerImagesLoadingRef.current;
  }, []);

  const applyDiningLayerStyles = useCallback((map) => {
    const colorExpr = [
      "case",
      ["get", "selected"],
      "#FFFFFF",
      [
        "match",
        ["get", "diningStatus"],
        "Available", DINING_COLORS.available,
        "Opening Soon", DINING_COLORS.openingSoon,
        "Unavailable", DINING_COLORS.unavailable,
        DINING_COLORS.unavailable,
      ],
    ];
    const glowExpr = [
      "match",
      ["get", "diningStatus"],
      "Available", DINING_COLORS.haloAvailable,
      "Opening Soon", DINING_COLORS.haloOpeningSoon,
      "Unavailable", DINING_COLORS.haloUnavailable,
      DINING_COLORS.haloUnavailable,
    ];

    if (map.getLayer("dining-markers-glow")) {
      map.setPaintProperty("dining-markers-glow", "circle-color", glowExpr);
      map.setPaintProperty("dining-markers-glow", "circle-radius", 16);
      map.setPaintProperty("dining-markers-glow", "circle-opacity", 0.22);
      map.setPaintProperty("dining-markers-glow", "circle-blur", 1);
      map.setPaintProperty("dining-markers-glow", "circle-emissive-strength", 1);
    }

    if (map.getLayer("dining-markers")) {
      map.setPaintProperty("dining-markers", "circle-color", colorExpr);
      map.setPaintProperty("dining-markers", "circle-radius", 11.2);
      map.setPaintProperty("dining-markers", "circle-stroke-width", 2);
      map.setPaintProperty("dining-markers", "circle-stroke-color", "rgba(255,255,255,0.92)");
      map.setPaintProperty("dining-markers", "circle-emissive-strength", 1);
    }
  }, []);

  const updateDiningData = useCallback((map, halls, referenceDate) => {
    if (!diningMarkerImagesLoadedRef.current) {
      ensureDiningMarkerImages(map)
        .then(() => {
          if (mapRef.current === map && isMapLoadedRef.current) {
            updateDiningData(map, halls, referenceDate);
          }
        })
        .catch((error) => {
          console.error("Error loading dining marker images:", error);
        });
      return;
    }

    const features = (Array.isArray(halls) ? halls : []).map((hall, index) => {
      const statusInfo = getDiningStatusInfo(hall, referenceDate);

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            Number(hall.displayLongitude ?? hall.longitude),
            Number(hall.displayLatitude ?? hall.latitude),
          ],
        },
        properties: {
          id: hall.id || `dining-${index}`,
          name: hall.name,
          shortName: hall.shortName || hall.name,
          markerIcon: hall.kind === "retail" ? "market-shop-emoji" : "dining-hall-emoji",
          diningStatus: statusInfo.status,
          diningBadgeLabel: statusInfo.badgeLabel,
          diningSummary: statusInfo.summary,
          selected: selectedDining?.id === hall.id,
          pageUrl: hall.pageUrl || "",
          trueLongitude: Number(hall.longitude),
          trueLatitude: Number(hall.latitude),
          dateKey: hall.dateKey || "",
          mealCount: Array.isArray(hall.meals) ? hall.meals.length : 0,
        },
      };
    });

    const geojson = { type: "FeatureCollection", features };

    if (map.getSource("dining")) {
      map.getSource("dining").setData(geojson);
      applyDiningLayerStyles(map);
      moveParkingLayersToFront(map);
      moveBookableLayersToFront(map);
      moveDiningLayersToFront(map);
      return;
    }

    map.addSource("dining", { type: "geojson", data: geojson });

    map.addLayer({
      id: "dining-markers-glow",
      type: "circle",
      source: "dining",
      paint: {
        "circle-radius": 16,
        "circle-color": DINING_COLORS.haloAvailable,
        "circle-opacity": 0.22,
        "circle-blur": 1,
        "circle-emissive-strength": 1,
      },
    });

    map.addLayer({
      id: "dining-markers",
      type: "circle",
      source: "dining",
      paint: {
        "circle-radius": 11.2,
        "circle-color": DINING_COLORS.available,
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(255,255,255,0.92)",
        "circle-emissive-strength": 1,
      },
    });

    map.addLayer({
      id: "dining-labels",
      type: "symbol",
      source: "dining",
      layout: {
        "icon-image": ["get", "markerIcon"],
        "icon-size": 0.15,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {},
    });

    map.addLayer({
      id: "dining-hit-area",
      type: "circle",
      source: "dining",
      paint: {
        "circle-radius": 16,
        "circle-opacity": 0,
      },
    });

    applyDiningLayerStyles(map);
    moveParkingLayersToFront(map);
    moveBookableLayersToFront(map);
    moveDiningLayersToFront(map);
  }, [applyDiningLayerStyles, ensureDiningMarkerImages, moveBookableLayersToFront, moveDiningLayersToFront, moveParkingLayersToFront, selectedDining]);

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
              "circle-radius": 16,
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

  useEffect(() => {
    diningHallsRef.current = Array.isArray(diningHalls) ? diningHalls : [];
  }, [diningHalls]);

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
      const blockerLayers = [
        "dining-hit-area",
        "dining-labels",
        "dining-markers",
        "parking-hit-area",
        "parking-labels",
        "parking-markers",
        "bookable-room-hit-area",
        "bookable-room-labels",
        "bookable-rooms",
      ].filter((layerId) => map.getLayer(layerId));

      if (blockerLayers.length) {
        const blockerFeatures = map.queryRenderedFeatures(e.point, { layers: blockerLayers });
        if (blockerFeatures.length) return;
      }

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

  const ensureDiningLayerEvents = useCallback(() => {
    const map = mapRef.current;
    if (!map || diningLayerEventsBoundRef.current) return;
    if (!map.getLayer("dining-markers")) return;

    diningLayerEventsBoundRef.current = true;
    const interactiveDiningLayers = ["dining-hit-area", "dining-labels", "dining-markers"];

    const showDiningSelection = (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: interactiveDiningLayers.filter((layerId) => map.getLayer(layerId)),
      });
      const feature = features[0];
      if (!feature) return;

      playMapTapHaptic();

      map.flyTo({
        center: [
          Number(feature.properties.trueLongitude ?? feature.geometry.coordinates[0]),
          Number(feature.properties.trueLatitude ?? feature.geometry.coordinates[1]),
        ],
        zoom: Math.max(map.getZoom(), 17),
        speed: 0.8,
        curve: 1.5,
        easing: (t) => t * (2 - t),
        duration: 1200,
      });

      if (onDiningSelect) {
        const hall = diningHallsRef.current.find(
          (candidate) => candidate.id === feature.properties.id
        );
        if (hall) {
          onDiningSelect(hall);
        } else {
          onDiningSelect({
            id: feature.properties.id,
            name: feature.properties.name,
            shortName: feature.properties.shortName,
            latitude: Number(feature.properties.trueLatitude),
            longitude: Number(feature.properties.trueLongitude),
            pageUrl: feature.properties.pageUrl || "",
            dateKey: feature.properties.dateKey || "",
            meals: [],
          });
        }
      }
    };

    interactiveDiningLayers.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", layerId, showDiningSelection);
    });
  }, [onDiningSelect]);

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
    const isMobile = window.innerWidth <= 768;
    const defaultCamera = getDefaultCamera(isMobile);

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: defaultCamera.center,
      zoom: defaultCamera.zoom,
      pitch: defaultCamera.pitch,
      bearing: defaultCamera.bearing,
      attributionControl: false,
    });
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
      diningLayerEventsBoundRef.current = false;

      addMapLegend(map);
      updateDiningData(map, diningHalls, diningReferenceDate);
      ensureDiningLayerEvents();
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
      diningLayerEventsBoundRef.current = false;
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
        updateDiningData(map, diningHalls, diningReferenceDate);
        ensureBuildingLayerEvents();
        ensureBookableLayerEvents();
        ensureDiningLayerEvents();
      } else {
        map.once("styledata", () => {
          updateMapData(map, nextData, availabilityStart, availabilityEnd, selectedBuilding);
          updateBookableRoomData(map, nextData, availabilityStart, availabilityEnd);
          updateDiningData(map, diningHalls, diningReferenceDate);
          ensureBuildingLayerEvents();
          ensureBookableLayerEvents();
          ensureDiningLayerEvents();
        });
      }
    }
  }, [availabilityStart, availabilityEnd, selectedBuilding, updateMapData, updateBookableRoomData, updateDiningData, buildingsData, diningHalls, diningReferenceDate, ensureBuildingLayerEvents, ensureBookableLayerEvents, ensureDiningLayerEvents]);

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
    if (!isMapLoadedRef.current || !mapRef.current) return;
    const map = mapRef.current;
    if (map.isStyleLoaded()) {
      updateDiningData(map, diningHalls, diningReferenceDate);
      ensureDiningLayerEvents();
    } else {
      map.once("styledata", () => {
        updateDiningData(map, diningHalls, diningReferenceDate);
        ensureDiningLayerEvents();
      });
    }
  }, [diningHalls, diningReferenceDate, ensureDiningLayerEvents, updateDiningData]);

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
      map.setPaintProperty("building-dots-glow", "circle-radius", 7.2 + wave * 4.0);
      map.setPaintProperty("building-dots-glow", "circle-opacity", 0.18 + wave * 0.44);
      map.setPaintProperty("building-dots", "circle-color", loadingColor);
      map.setPaintProperty("building-dots", "circle-radius", 3.7 + wave * 0.95);
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

  useEffect(() => {
    if (!mapRef.current || !isMapLoadedRef.current) return;
    const defaultCamera = getDefaultCamera(window.innerWidth <= 768);
    mapRef.current.flyTo({
      center: defaultCamera.center,
      zoom: defaultCamera.zoom,
      pitch: defaultCamera.pitch,
      bearing: defaultCamera.bearing,
      speed: 0.8,
      curve: 1.8,
      easing: (t) => t * (2 - t),
      duration: 1500,
    });
  }, [mapResetToken]);

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
    const defaultCamera = getDefaultCamera(window.innerWidth <= 768);
    mapRef.current.flyTo({
      center: defaultCamera.center,
      zoom: defaultCamera.zoom,
      pitch: defaultCamera.pitch,
      bearing: defaultCamera.bearing,
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

export default CampusMap;
