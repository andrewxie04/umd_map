import './legend.css';

export function addMapLegend(map) {
  const legend = document.createElement('div');
  legend.className = 'map-legend';

  const statuses = [
    { label: 'Available', color: '#34C759' },
    { label: 'Unavailable', color: '#FF3B30' },
  ];

  statuses.forEach((status) => {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.backgroundColor = status.color;

    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = status.label;

    item.appendChild(dot);
    item.appendChild(label);
    legend.appendChild(item);
  });

  map.getContainer().appendChild(legend);
}
