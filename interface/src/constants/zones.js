export const ZONE_COLORS = {
  red:    '#FF3B30',
  orange: '#FF9500',
  green:  '#34C759',
}

export const ZONE_LABELS = {
  red:    '🔴 Red Zone',
  orange: '🟠 Orange Zone',
  green:  '🟢 Green Zone',
}

export const ZONE_RADIUS_THRESHOLDS = {
  red:    0.33, // 0–33% of radius_km
  orange: 0.66, // 33–66%
  green:  1.00, // 66–100%
}

export const WS_URL = 'ws://localhost:8080/ws'