import './legend.css';

export function addMapLegend(map) {
  const container = map.getContainer();
  const existing = container.querySelector('.map-legend');
  if (existing) existing.remove();

  const legend = document.createElement('div');
  legend.className = 'map-legend';
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', 'Map legend');

  const statuses = [
    { label: 'Available', color: '#34C759' },
    { label: 'Opening Soon', color: '#FFCC00' },
    { label: 'Unavailable', color: '#FF3B30' },
  ];

  statuses.forEach((status) => {
    const item = document.createElement('div');
    item.className = 'legend-item';

    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.backgroundColor = status.color;
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = status.label;

    item.appendChild(dot);
    item.appendChild(label);
    legend.appendChild(item);
  });

  container.appendChild(legend);
}
